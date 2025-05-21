import { authenticateToken } from "@/lib/auth";
import { pusher } from "@/lib/Pusher";
import prisma from "@/prisma/client";
import { authCustomer } from "@/utils/Auth";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import paypal from "@paypal/checkout-server-sdk";
import { createPayOSPaymentLink } from "@/lib/payos";

// Định nghĩa interface CartItem dựa theo schema Prisma
interface CartItem {
  cartitem_id: number;
  cart_id: number;
  size_id: number;
  product_id: number;
  quantity: number;
  Product: {
    price: string | number;
  };
}

// Định nghĩa interface Permission
interface Permission {
  permission: string;
  permission_id?: number;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-12-18.acacia" as any, // Giữ phiên bản ổn định
});

function getPaypalClient() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!clientId || !secret) {
    throw new Error("Missing PayPal credentials");
  }
  const environment =
    process.env.NODE_ENV === "production"
      ? new paypal.core.LiveEnvironment(clientId, secret)
      : new paypal.core.SandboxEnvironment(clientId, secret);
  return new paypal.core.PayPalHttpClient(environment);
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get("token")?.value;

  if (!token) {
    return NextResponse.json(
      { message: "Vui lòng đăng nhập" },
      { status: 404 }
    );
  }

  try {
    const user = await authenticateToken(token);
    const customer = await authCustomer(req);
    
    // Kiểm tra xem người dùng có phải là admin hay không
    console.log('User info:', JSON.stringify(user, null, 2));
    
    // Sử dụng trực tiếp trường isAdmin từ authenticate token
    const isAdmin = user?.isAdmin === true;
    
    // Fallback cho trường hợp không có isAdmin
    const adminFallback = 
      // Người dùng có quyền update
      user?.permissions?.some(
        (item: { permission: Permission }) => item.permission?.permission === "update"
      ) || 
      // Username là admin
      user?.username === "admin" ||
      // RoleId là 1 (thường dành cho admin)
      user?.roleId === 1 ||
      // Customer ID là admin default (16 trong trường hợp này)
      customer?.customer_id === 16;
      
    // Sử dụng isAdmin hoặc adminFallback
    const finalIsAdmin = isAdmin || adminFallback;
    
    console.log('Is Admin:', finalIsAdmin, 'Customer ID:', customer?.customer_id);

    // Lấy tất cả các đơn hàng cho admin, hoặc chỉ đơn hàng của người dùng hiện tại
    const allOrders = await prisma.order.findMany({
      where: finalIsAdmin ? {} : { customer_id: customer?.customer_id },
      include: {
        Customer: true,
        OrderItems: {
          include: {
            Product: {
              include: {
                Brand: true,
                Images: {
                  take: 1,
                },
              },
            },
            Size: true,
          },
        },
        Payments: true,
      },
      orderBy: {
        order_date: "desc",
      },
    });
    
    console.log('Total orders found:', allOrders.length);
    
    // Khởi tạo dữ liệu trả về
    const orders = allOrders;
    const manageOrder = finalIsAdmin ? allOrders : [];
    
    if (finalIsAdmin) {
      console.log('Admin user, returning all orders in both orders and manageOrder arrays:', manageOrder.length);
      
      return NextResponse.json(
        {
          orders: allOrders,
          manageOrder: allOrders,  // Đảm bảo cả hai đều có dữ liệu
          message: "Lấy danh sách đơn hàng thành công.",
        },
        { status: 200 }
      );
    }
    
    // Nếu không phải admin và không có đơn hàng
    if (!orders.length) {
      return NextResponse.json(
        { message: "Không có đơn hàng nào." },
        { status: 404 }
      );
    }

    // Người dùng thường chỉ cần orders, manageOrder rỗng
    return NextResponse.json(
      {
        orders,
        manageOrder: [],
        message: "Lấy danh sách đơn hàng thành công.",
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { addressId, paymentMethod, finalTotal } = await req.json();

  const token = req.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.json(
      { message: "Vui lòng đăng nhập" },
      { status: 404 }
    );
  }

  try {
    const customer = await authCustomer(req);
    if (!customer) {
      return NextResponse.json(
        { message: "vui lòng đăng nhập" },
        { status: 400 }
      );
    }

    const address = await prisma.addressShipper.findUnique({
      where: { address_id: addressId, customer_id: customer.customer_id },
      select: { address_id: true, customer_id: true },
    });
    if (!address) {
      return NextResponse.json(
        { message: "Địa chỉ giao hàng không hợp lệ" },
        { status: 400 }
      );
    }

    const cart = await prisma.cart.findFirst({
      where: { customer_id: customer?.customer_id },
      include: {
        CartItems: {
          include: { Product: { select: { price: true } }, Size: true },
        },
      },
    });
    if (!cart || cart.CartItems.length === 0) {
      return NextResponse.json(
        { error: "Cart is empty or does not exist." },
        { status: 400 }
      );
    }

    // Sử dụng finalTotal từ frontend làm totalAmount
    const totalAmount = Number(finalTotal);
    if (isNaN(totalAmount) || totalAmount < 0) {
      return NextResponse.json(
        { message: "Tổng tiền không hợp lệ" },
        { status: 400 }
      );
    }

    const order = await prisma.order.create({
      data: {
        customer_id: customer.customer_id,
        address_id: addressId,
        order_date: new Date(),
        total_amount: totalAmount, // Sử dụng finalTotal trực tiếp
        order_state: "PENDING",
        created_at: new Date(),
        OrderItems: {
          create: cart.CartItems.map((item: CartItem) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            price: Number(item.Product.price),
            size_id: item.size_id,
          })),
        },
      },
    });
    // thanh toán stripe
    if (paymentMethod === "CREDIT_CARD") {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalAmount),
        currency: "vnd",
        metadata: { order_id: order.order_id.toString() },
        description: `Thanh toán đơn hàng #${order.order_id}`,
      });

      await prisma.payment.create({
        data: {
          order_id: order.order_id,
          payment_method: "CREDIT_CARD",
          payment_status: "PENDING",
          payment_amount: totalAmount,
          stripe_payment_intent: paymentIntent.id,
          created_at: new Date(),
        },
      });

      await prisma.cartItem.deleteMany({ where: { cart_id: cart.cart_id } });
      await prisma.cart.delete({ where: { cart_id: cart.cart_id } });

      await pusher.trigger("orders", "new-order", {
        orderId: order.order_id,
        customerName: customer?.name,
        totalAmount,
      });

      return NextResponse.json(
        {
          order,
          paymentIntentClientSecret: paymentIntent.client_secret,
          message: "Vui lòng hoàn tất thanh toán qua Stripe",
        },
        { status: 201 }
      );
    }
    // thanh toán paypal
    else if (paymentMethod === "E_WALLET") {
      const client = getPaypalClient();
      const exchangeRate = 25000;
      const request = new paypal.orders.OrdersCreateRequest();
      request.requestBody({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: (totalAmount / exchangeRate).toFixed(2),
            },
          },
        ],
        application_context: {
          return_url: `${process.env.NEXT_PUBLIC_API_URL}/api/paypal/success`,
          cancel_url: `${process.env.NEXT_PUBLIC_API_URL}/api/paypal/cancel`,
        },
      });
      await pusher.trigger("orders", "new-order", {
        orderId: order.order_id,
        customerName: customer?.name,
        totalAmount,
      });

      const response = await client.execute(request);

      // Lưu thông tin thanh toán vào database với trạng thái PENDING
      await prisma.payment.create({
        data: {
          order_id: order.order_id,
          paypal_order_id: response.result.id,
          payment_method: paymentMethod,
          payment_amount: totalAmount,
          payment_status: "PENDING",
        },
      });

      return NextResponse.json(
        {
          id: response.result.id,
          status: response.result.status,
          links: response.result.links,
        },
        { status: 200 }
      );
    }
    // Thêm phương thức thanh toán PayOS
    else if (paymentMethod === "BANK_TRANSFER") {
      try {
        // Sử dụng URL ngrok cho webhook
        const webhookUrl = `${process.env.NEXT_PUBLIC_NGROK_URL}/api/payos-webhook`;
        
        // Tạo link thanh toán qua PayOS
        
        // Sử dụng URL API cho webhook và các endpoint xử lý
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;
        
        // Sử dụng URL web chính cho các trang chuyển hướng người dùng
        const webUrl = process.env.NEXT_PUBLIC_API_URL; // Bạn có thể thay đổi biến này nếu có domain riêng cho web chính
        
        // URL chuyển hướng khi hủy và hoàn thành thanh toán
        const cancelUrl = `${webUrl}/order/cancel?orderCode=${order.order_id}`;
        const returnUrl = `${webUrl}/order/success?orderCode=${order.order_id}`; // Đảm bảo rằng web có route này
        
        // Tạo mô tả đơn hàng
        const description = `Thanh toán đơn hàng #${order.order_id}`;
        
        // Tạo thông tin người mua
        const buyerInfo = {
          name: customer?.name,
          email: customer?.email,
          phone: customer?.phone || undefined,
        };
        
        // Tạo mã đơn hàng duy nhất cho PayOS bằng cách kết hợp order_id và một số ngẫu nhiên
        // Đảm bảo rằng nó luôn là một số dương và không quá lớn
        // Sử dụng 6 chữ số cuối của timestamp để tránh số quá lớn
        const timestampSuffix = Date.now() % 1000000; // Lấy 6 chữ số cuối của timestamp
        const uniqueOrderCode = order.order_id * 1000000 + timestampSuffix;
        
        // Gọi API PayOS để tạo link thanh toán
        const payosResponse = await createPayOSPaymentLink(
          uniqueOrderCode,
          Math.round(Number(totalAmount)),
          description,
          buyerInfo,
          cancelUrl,
          returnUrl
        );
        
        // Lưu thông tin thanh toán vào database
        await prisma.payment.create({
          data: {
            order_id: order.order_id,
            payment_method: "BANK_TRANSFER",
            payment_status: "PENDING",
            payment_amount: totalAmount,
            created_at: new Date(),
          },
        });
        
        // Xóa giỏ hàng sau khi đặt hàng thành công
        await prisma.cartItem.deleteMany({ where: { cart_id: cart.cart_id } });
        await prisma.cart.delete({ where: { cart_id: cart.cart_id } });
        
        // Thông báo đơn hàng mới
        await pusher.trigger("orders", "new-order", {
          orderId: order.order_id,
          customerName: customer?.name,
          totalAmount,
        });
        
        // Trả về thông tin link thanh toán PayOS
        return NextResponse.json(
          {
            order,
            paymentUrl: payosResponse.data.checkoutUrl,
            message: "Vui lòng hoàn tất thanh toán qua PayOS",
          },
          { status: 201 }
        );
      } catch (error) {
        console.error("PayOS payment error:", error);
        return NextResponse.json(
          { error: "Lỗi tạo link thanh toán PayOS" },
          { status: 500 }
        );
      }
    }
    // thanh toán khi nhận đơn hàng
    await prisma.payment.create({
      data: {
        order_id: order.order_id,
        payment_method: paymentMethod,
        payment_amount: totalAmount,
        payment_status: "PENDING",
      },
    });

    await prisma.cartItem.deleteMany({ where: { cart_id: cart.cart_id } });
    await prisma.cart.delete({
      where: { cart_id: cart.cart_id },
    });

    await pusher.trigger("orders", "new-order", {
      orderId: order.order_id,
      customerName: customer?.name,
      totalAmount,
    });

    return NextResponse.json(
      { order, message: "Đặt hàng thành công" },
      { status: 201 }
    );
  } catch (error: any) {
    console.log(error);
    return NextResponse.json({ message: error.message }, { status: 501 });
  }
}

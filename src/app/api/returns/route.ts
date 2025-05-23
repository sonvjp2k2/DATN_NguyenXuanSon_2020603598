import { authenticateToken } from "@/lib/auth";
import prisma from "@/prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  const user = await authenticateToken(token);
  console.log('User info in returns API:', JSON.stringify(user, null, 2));
  
  // Xác định quyền admin
  const isAdmin = user?.isAdmin === true;
  const adminFallback = 
    // Kiểm tra permissions
    user?.permissions?.some((item: any) => item.permission?.permission === "update") ||
    // Kiểm tra username
    user?.username === "admin" ||
    // Kiểm tra roleId
    user?.roleId === 1;
    
  const finalIsAdmin = isAdmin || adminFallback;
  console.log('Is Admin (returns):', finalIsAdmin);
  
  if (!finalIsAdmin) {
    console.log("Access denied: Redirecting to login page");
    return NextResponse.json({ message: "error" }, { status: 401 });
  }
  const returns = await prisma.returnProduct.findMany({
    select: {
      return_id: true,
      order_id: true,
      product_id: true,
      return_reason: true,
      return_date: true,
      return_status: true,
      return_amount: true,
      Product: {
        select: {
          product_name: true,
          Images: {
            take: 1,
            select: {
              image_url: true,
            },
          },
        },
      },
      Order: {
        select: {
          order_date: true,
          order_state: true,
          OrderItems: {
            select: {
              quantity: true,
              Size: true,
            },
          },
        },
      },
    },
    orderBy: {
      return_date: "desc", // Sắp xếp theo ngày yêu cầu hoàn trả, mới nhất trước
    },
  });
  return NextResponse.json({ returns }, { status: 200 });
}
export async function POST(req: NextRequest) {
  const { order_id, product_id, return_reason } = await req.json();
  // Kiểm tra dữ liệu đầu vào
  if (!order_id || !product_id) {
    return NextResponse.json(
      { message: "Order ID and Product ID are required" },
      { status: 400 }
    );
  }

  try {
    const order = await prisma.order.findUnique({
      where: {
        order_id,
      },
      include: { OrderItems: true, Returns: true },
    });
    if (!order) {
      return NextResponse.json(
        { message: "đơn hàng không tồn tại" },
        { status: 400 }
      );
    }
    // Kiểm tra sản phẩm trong đơn hàng
    const orderItem = order?.OrderItems.find(
      (item: { product_id: number }) => item.product_id === product_id
    );
    if (!orderItem) {
      return NextResponse.json(
        { message: "Product not found in this order" },
        { status: 404 }
      );
    }
    // Kiểm tra thời gian hoàn trả (nếu đã giao hàng)
    if (order.order_state === "DELIVERED") {
      if (!order.order_date) {
        return NextResponse.json(
          { message: "Ngày đặt hàng không hợp lệ" },
          { status: 500 }
        );
      }

      const currentDate = new Date();
      const orderDate = new Date(order.order_date);
      const timeDifference = currentDate.getTime() - orderDate.getTime();
      const daysDifference = timeDifference / (1000 * 3600 * 24);

      if (daysDifference > 15) {
        return NextResponse.json(
          {
            message:
              "Không thể hoàn trả vì đơn hàng đã quá 15 ngày kể từ ngày đặt",
          },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { message: "Chỉ đơn hàng đã giao mới được phép hoàn trả" },
        { status: 400 }
      );
    }
    // Kiểm tra xem sản phẩm đã được yêu cầu hoàn trả chưa
    const existingReturn = order?.Returns.find(
      (rtn: { product_id: number }) => rtn.product_id === product_id
    );
    if (existingReturn) {
      return NextResponse.json(
        { message: "This product has already been requested for return" },
        { status: 400 }
      );
    }
    // Tính số tiền hoàn trả (dựa trên giá sản phẩm trong OrderItem)
    const return_amount = Number(order.total_amount);
    // Tạo bản ghi hoàn trả mới
    const returnProduct = await prisma.returnProduct.create({
      data: {
        order_id,
        product_id,
        return_reason: return_reason || null,
        return_date: new Date(),
        return_status: "PENDING",
        return_amount,
      },
    });
    // Cập nhật trạng thái đơn hàng nếu cần

    return NextResponse.json(
      {
        message: "Return request created successfully",
        returnProduct,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

import { authenticateToken } from "@/lib/auth";
import prisma from "@/prisma/client";
import { authCustomer } from "@/utils/Auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = await params;
  const orderId = Number(id);
  const customer = await authCustomer(req);
  const token = req.cookies.get("token")?.value;
  
  try {
    // Kiểm tra quyền admin trước khi tìm đơn hàng
    const user = await authenticateToken(token);
    console.log('User info for order detail:', JSON.stringify(user, null, 2));
    
    // Sử dụng trực tiếp trường isAdmin từ authenticate token
    const isAdmin = user?.isAdmin === true;
    
    // Fallback cho trường hợp không có isAdmin
    const adminFallback = 
      // Người dùng có quyền update
      user?.permissions?.some(
        (item: { permission: { permission: string } }) => item.permission?.permission === "update"
      ) || 
      // Username là admin
      user?.username === "admin" ||
      // RoleId là 1 (thường dành cho admin)
      user?.roleId === 1 ||
      // Customer ID là admin default (16 trong trường hợp này)
      customer?.customer_id === 16;
      
    // Sử dụng isAdmin hoặc adminFallback
    const finalIsAdmin = isAdmin || adminFallback;
    
    console.log('Is Admin (order detail):', finalIsAdmin, 'Order ID:', orderId);
    
    // Nếu không phải admin, kiểm tra xem đơn hàng có thuộc về khách hàng hiện tại không
    if (!finalIsAdmin) {
      const customerOrder = await prisma.order.findFirst({
        where: {
          order_id: orderId,
          customer_id: customer?.customer_id,
        },
      });
      
      if (!customerOrder) {
        return NextResponse.json(
          { message: "Bạn không có quyền xem đơn hàng này" },
          { status: 403 }
        );
      }
    }
    
    // Lấy thông tin đơn hàng cho người dùng thường (nếu họ được phép xem)
    const getOrderId = await prisma.order.findUnique({
      where: {
        order_id: orderId,
      },
      select: {
        OrderItems: {
          include: {
            Size: true,
            Product: {
              include: {
                Images: {
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    // order admin
    const OrderManage = await prisma.order.findUnique({
      where: {
        order_id: orderId,
      },
      select: {
        order_id: true,
        order_date: true,
        total_amount: true,
        order_state: true,
        Customer: {
          select: {
            name: true,
            phone: true,
            AddressShipper: {
              select: {
                country: true,
                is_default: true,
                province: true,
                district: true,
                ward: true,
                street_address: true,
                note: true,
              },
              where: {
                is_default: true,
              },
            },
          },
        },
        OrderItems: {
          select: {
            orderitem_id: true,
            quantity: true,
            price: true,
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
          },
        },
      },
    });
    return NextResponse.json(
      { getOrderId, OrderManage, message: `found Id ${orderId} success` },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = await params;
  const orderId = Number(id);
  try {
    const deletedOrder = await prisma.$transaction(async (tx: any) => {
      await tx.orderItem.deleteMany({
        where: {
          order_id: orderId,
        },
      });
      await tx.returnProduct.deleteMany({
        where: {
          order_id: orderId,
        },
      });
      await tx.payment.deleteMany({
        where: {
          order_id: orderId,
        },
      });
      // Sau đó xóa Order
      return await tx.order.delete({
        where: {
          order_id: orderId,
        },
        select: { order_id: true },
      });
    });

    return NextResponse.json(
      { deletedOrder, message: `deleted success` },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await req.cookies.get("token")?.value;
  const { id } = await params;
  const orderId = Number(id);
  const { payment_status, order_state } = await req.json();
  const customer = await authCustomer(req);
  const user = await authenticateToken(token);
  
  console.log('User info for update order:', JSON.stringify(user, null, 2));
  
  // Sử dụng trực tiếp trường isAdmin từ authenticate token
  const isAdmin = user?.isAdmin === true;
  
  // Fallback cho trường hợp không có isAdmin
  const adminFallback = 
    // Người dùng có quyền update
    user?.permissions?.some(
      (item: { permission: { permission: string } }) => item.permission?.permission === "update"
    ) || 
    // Username là admin
    user?.username === "admin" ||
    // RoleId là 1 (thường dành cho admin)
    user?.roleId === 1 ||
    // Customer ID là admin default (16 trong trường hợp này)
    customer?.customer_id === 16;
    
  // Sử dụng isAdmin hoặc adminFallback
  const finalIsAdmin = isAdmin || adminFallback;
  
  console.log('Is Admin (update order):', finalIsAdmin, 'Order ID:', orderId);
  
  if (!finalIsAdmin) {
    return NextResponse.json(
      { message: "Bạn không có quyền cập nhật đơn hàng" },
      { status: 403 }
    );
  }

  try {
    const update = await prisma.order.update({
      where: {
        order_id: orderId,
      },
      data: {
        order_state: order_state,
        order_date: new Date(),
        Payments: {
          updateMany: {
            where: { order_id: orderId },
            data: {
              payment_status: payment_status,
            },
          },
        },
      },
      select: {
        Payments: { select: { payment_status: true } },
      },
    });
    if (update.Payments[0].payment_status === "REFUNDED") {
      await prisma.returnProduct.updateMany({
        where: {
          order_id: orderId,
        },
        data: {
          return_status: "COMPLETED",
        },
      });
    }
    return NextResponse.json(
      { update, message: "cập nhật thành công" },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 501 });
  }
}

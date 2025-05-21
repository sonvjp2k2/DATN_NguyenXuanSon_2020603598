import { NextRequest, NextResponse } from "next/server";
import prisma from "@/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const paymentId = searchParams.get("paymentId");
  const orderCode = searchParams.get("orderCode");

  // Xử lý orderCode thành order_id
  let orderId = null;
  if (orderCode) {
    const orderCodeNum = parseInt(orderCode);
    // Nếu orderCode là số lớn (theo công thức mới: order_id * 1000000 + timestamp)
    if (orderCodeNum > 1000000) {
      orderId = Math.floor(orderCodeNum / 1000000);
      console.log(`Parse orderCode: ${orderCode} -> orderId: ${orderId}`);
    } else {
      orderId = orderCodeNum;
    }
  }

  if (!orderId) {
    return NextResponse.json(
      { message: "Missing order information" },
      { status: 400 }
    );
  }

  try {
    // Cập nhật trạng thái thanh toán
    if (paymentId) {
      await prisma.payment.updateMany({
        where: {
          order_id: orderId,
          payment_method: "BANK_TRANSFER",
        },
        data: {
          payment_status: "FAILED",
          updated_at: new Date(),
        },
      });
    }

    // Cập nhật trạng thái đơn hàng
    await prisma.order.update({
      where: { order_id: orderId },
      data: {
        order_state: "CANCELLED",
        updated_at: new Date(),
      },
    });

    // Chuyển hướng về trang hủy đơn hàng
    const webUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    return NextResponse.redirect(
      new URL(`${webUrl}/order/cancel?orderCode=${orderCode}`),
      302
    );
  } catch (error) {
    console.error("Lỗi xử lý PayOS cancel:", error);
    
    // Chuyển hướng tới trang lỗi
    const webUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    return NextResponse.redirect(
      new URL(`${webUrl}/order/cancel?orderCode=${orderCode}&error=true`),
      302
    );
  }
} 

import { NextRequest, NextResponse } from "next/server";
import { getPayOSPaymentInfo } from "@/lib/payos";
import prisma from "@/prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const paymentId = searchParams.get("paymentId");
  const orderCode = searchParams.get("orderCode");
  const status = searchParams.get("status");
  const id = searchParams.get("id");

  if (!paymentId && !orderCode) {
    return NextResponse.json(
      { message: "Missing payment information" },
      { status: 400 }
    );
  }

  try {
    // Lấy orderId từ parameter hoặc thông tin thanh toán
    let orderId: number;
    let paymentStatus: string = "UNKNOWN";
    
    if (paymentId) {
      // Lấy thông tin thanh toán từ PayOS
      const paymentInfo = await getPayOSPaymentInfo(paymentId);
      
      if (!paymentInfo || !paymentInfo.data) {
        return NextResponse.json(
          { message: "Không thể lấy thông tin thanh toán" },
          { status: 400 }
        );
      }

      const paymentData = paymentInfo.data;
      // orderCode bây giờ được tạo theo công thức: order_id * 1000000 + timestamp
      // Để lấy lại order_id, chúng ta chia nguyên cho 1000000
      const orderCodeNum = parseInt(paymentData.orderCode);
      orderId = Math.floor(orderCodeNum / 1000000);
      console.log(`Parse orderCode: ${paymentData.orderCode} -> orderId: ${orderId}`);
      
      // Xử lý status dựa trên code trả về từ PayOS (code "00" tương đương với PAID)
      paymentStatus = paymentData.code === "00" ? "PAID" : "CANCELLED";
      console.log(`Payment status set to: ${paymentStatus} based on code: ${paymentData.code}`);
    } else if (orderCode) {
      // Nếu orderCode là số nguyên PayOS (lớn), lấy orderId bằng cách chia cho 1000000
      // Nếu orderCode là đúng order_id, sử dụng trực tiếp
      const orderCodeNum = parseInt(orderCode);
      if (orderCodeNum > 1000000) {
        orderId = Math.floor(orderCodeNum / 1000000);
        console.log(`Parse orderCode: ${orderCode} -> orderId: ${orderId}`);
      } else {
        orderId = orderCodeNum;
      }
      
      // Kiểm tra status từ URL trước
      if (status === "PAID") {
        paymentStatus = "PAID";
      } else {
        // Nếu không có status hoặc status không phải PAID, kiểm tra trong database
        const payment = await prisma.payment.findFirst({
          where: {
            order_id: orderId,
            payment_method: "BANK_TRANSFER",
          },
        });
        
        paymentStatus = payment?.payment_status === "COMPLETED" ? "PAID" : "UNKNOWN";
      }
    } else {
      return NextResponse.json(
        { message: "Missing order information" },
        { status: 400 }
      );
    }

    console.log(`Xử lý đơn hàng: ${orderId}, trạng thái: ${paymentStatus}, id: ${id}`);

    // Kiểm tra trạng thái thanh toán
    if (paymentStatus === "PAID" || status === "PAID") {
      // Cập nhật payment record nếu chưa được cập nhật bởi webhook
      await prisma.payment.updateMany({
        where: {
          order_id: orderId,
          payment_method: "BANK_TRANSFER",
          payment_status: { not: "COMPLETED" }
        },
        data: {
          payment_status: "COMPLETED",
          updated_at: new Date(),
        },
      });

      // Cập nhật order status nếu chưa được cập nhật
      await prisma.order.updateMany({
        where: { 
          order_id: orderId,
          order_state: "PENDING"
        },
        data: {
          order_state: "PROCESSING",
          updated_at: new Date(),
        },
      });

      // Chuyển hướng tới trang đơn hàng, sử dụng web URL thay vì ngrok
      const webUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      return NextResponse.redirect(
        new URL(`${webUrl}/order/success?orderCode=${orderId}`),
        302
      );
    } else {
      // Thanh toán không thành công, chuyển hướng tới trang thất bại, sử dụng web URL thay vì ngrok
      const webUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      return NextResponse.redirect(
        new URL(`${webUrl}/order/cancel?orderCode=${orderId}`),
        302
      );
    }
  } catch (error) {
    console.error("Lỗi xử lý PayOS success:", error);
    
    // Chuyển hướng tới trang lỗi, sử dụng web URL thay vì ngrok
    const webUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    return NextResponse.redirect(
      new URL(`${webUrl}/order/cancel`),
      302
    );
  }
} 

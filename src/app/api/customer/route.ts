import { authenticateToken } from "@/lib/auth";
import prisma from "@/prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  const user = await authenticateToken(token);
  console.log('User info in customer API:', JSON.stringify(user, null, 2));
  
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
  console.log('Is Admin (customer):', finalIsAdmin);
  
  if (!finalIsAdmin) {
    console.log("Access denied: Redirecting to login page");
    return NextResponse.json({ message: "error" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const search = searchParams.get("search") ?? "";
  const limit = Number(searchParams.get("limit")) || 5;
  const page = Number(searchParams.get("page")) || 1;
  const sortOrder: any = searchParams.get("sortOrder") || "asc";
  const totalRecord = await prisma.customer.count({
    where: {
      name: {
        contains: search,
      },
    },
  });

  const totalPages = limit > 0 ? Math.ceil(totalRecord / limit) : 1;
  const totalSkipRecord = (page - 1) * limit;
  const getCustomer = await prisma.customer.findMany({
    skip: totalSkipRecord,
    take: limit,
    where: {
      name: {
        contains: search,
      },
    },
    select: {
      customer_id: true,
      name: true,
      email: true,
      phone: true,
      roleId: true,
      id_card_front: true,
      id_card_data: true,
    },
    orderBy: {
      name: sortOrder,
    },
  });

  return NextResponse.json(
    {
      getCustomer,
      pagination: {
        limit,
        totalRecord,
        currentPage: page,
        totalPages,
      },
      message: "success",
    },
    { status: 201 }
  );
}
export async function POST(req: NextRequest) {
  const { name, email, phone, id_card_front, id_card_data } = await req.json();
  try {
    //Image

    const createCustomer = await prisma.customer.create({
      data: {
        name,
        email,
        phone,
        roleId: 1,
        id_card_front,
        id_card_data,
      },
    });
    return NextResponse.json(
      { createCustomer, message: "success" },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

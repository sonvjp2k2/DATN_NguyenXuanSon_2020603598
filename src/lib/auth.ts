import prisma from "@/prisma/client";
import jwt from "jsonwebtoken";
interface DecodedToken {
  username: string;
  // Có thể thêm các trường khác nếu cần
}

const JWT_SECRET = process.env.JWT_SECRET;
export async function authenticateToken(token: string | undefined) {
  if (!token) return null;

  if (!JWT_SECRET) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
    const user = await prisma.customer.findUnique({
      where: { username: decoded.username },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });
    
    // Tạo đối tượng kết quả chứa thông tin đầy đủ của người dùng
    const result = {
      ...user,  // Thông tin cơ bản người dùng
      permissions: user?.role?.permissions || [], // Quyền hạn
      isAdmin: user?.roleId === 1 || user?.username === 'admin' // Xác định admin
    };
    
    return result; // Trả về đầy đủ thông tin người dùng
  } catch (err) {
    return null;
  }
}

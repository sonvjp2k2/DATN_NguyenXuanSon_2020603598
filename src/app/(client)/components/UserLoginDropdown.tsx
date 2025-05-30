/* eslint-disable @next/next/no-img-element */
"use client";
import React, { useContext, useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AiOutlineUser } from "react-icons/ai";
import { FaClipboardCheck } from "react-icons/fa";
import { useRouter } from "next/navigation";
import { RiAdminLine } from "react-icons/ri";
import { LiaPowerOffSolid } from "react-icons/lia";
import Image from "next/image";
import ExpiredStorage from "expired-storage";
import { ShopConText } from "@/app/context/Context";
interface UserLoginDropdownProps {
  user: { roleId: number; username: string; image: string };
}
const UserLoginDropdown = ({ user }: UserLoginDropdownProps) => {
  const router = useRouter();
  const { setCountCart, setUser } = useContext(ShopConText)!;
  const [expiredStorage, setExpiredStorage] = useState<ExpiredStorage | null>(
    null
  );
  useEffect(() => {
    if (typeof window !== "undefined") {
      setExpiredStorage(new ExpiredStorage(localStorage));
    }
  }, []);

  function handleLogout() {
    if (expiredStorage) {
      expiredStorage.clear();
      setCountCart(0);
      setUser({
        username: "",
        roleId: 1,
        image: "",
        name: "",
        phone: "",
        email: "",
      });
    }
    router.push("/logout");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="">
        <div className="flex w-full items-center ">
          <Image
            src={user.image || "/Image/anhdaidien.jpg"}
            width={100} // kích thước mặc định (cho mobile)
            height={100}
            alt="avatar"
            className="rounded-full md:w-8 md:h-8 "
          />
          <span className="hidden md:block text-base cursor-pointer mt-[3px] ml-2 capitalize">
            {user.username}
          </span>
        </div>
      </DropdownMenuTrigger>
      {/* Hiển thị khi hover */}

      <DropdownMenuContent className="mt-2">
        <DropdownMenuItem>
          <button
            className="text-sm text-gray-600 hover:text-red-600 flex items-center justify-center   "
            onClick={() => router.push("/profile")}
          >
            <AiOutlineUser className="mr-1 text-gray-900" />
            Tài Khoản Của Tôi
          </button>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <button
            className="text-sm text-gray-600 hover:text-red-600 flex items-center   "
            onClick={() => router.push("/profile/listorder")}
          >
            <FaClipboardCheck className="mr-1 text-gray-700" />
            Đơn Hàng Đã Mua
          </button>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {user.roleId === 1 && (
          <>
            <DropdownMenuItem>
              {" "}
              <button
                className="text-sm text-gray-600 hover:text-red-600 flex items-center justify-center mr-1"
                onClick={() => router.push("/admin")}
              >
                <RiAdminLine className="mr-1 text-gray-900" />
                Trang Quản Lý
              </button>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem>
          {" "}
          <button
            className="text-sm text-gray-600 hover:text-red-600 flex items-center justify-center mr-7"
            onClick={handleLogout}
          >
            <LiaPowerOffSolid className="mr-1 text-gray-900 " />
            Đăng Xuất
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserLoginDropdown;

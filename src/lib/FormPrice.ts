export const ForMatPrice = (value: number | string) => {
  // Chuyển đổi giá trị thành số nếu nó là chuỗi
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(numericValue);
};

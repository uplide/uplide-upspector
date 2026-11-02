export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4100";

export interface Product {
  id: number;
  name: string;
  price: number;
  reviewCount?: number;
}

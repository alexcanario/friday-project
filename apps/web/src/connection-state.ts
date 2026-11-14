export type ConnectionState = "loading" | "offline" | "connected";

export function connectionStateOf(status: "pending" | "error" | "success"): ConnectionState {
  if (status === "pending") return "loading";
  if (status === "error") return "offline";
  return "connected";
}

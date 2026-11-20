export type ConnectionState = "loading" | "offline" | "connected" | "reconnecting";

export function connectionStateOf(status: "pending" | "error" | "success"): ConnectionState {
  if (status === "pending") return "loading";
  if (status === "error") return "offline";
  return "connected";
}

export function displayState(
  live: ConnectionState | null,
  health: "pending" | "error" | "success",
  streaming = false,
): ConnectionState {
  return live ?? (streaming ? "loading" : connectionStateOf(health));
}

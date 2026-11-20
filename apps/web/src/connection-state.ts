export type ConnectionState = "loading" | "offline" | "connected" | "reconnecting";

export function connectionStateOf(status: "pending" | "error" | "success"): ConnectionState {
  if (status === "pending") return "loading";
  if (status === "error") return "offline";
  return "connected";
}

/** The live state only counts while it belongs to the stream now open (same key). */
export function liveStateFor(
  live: { key: string; state: ConnectionState } | null,
  key: string,
): ConnectionState | null {
  return live !== null && live.key === key ? live.state : null;
}

export function displayState(
  live: ConnectionState | null,
  health: "pending" | "error" | "success",
  streaming = false,
): ConnectionState {
  return live ?? (streaming ? "loading" : connectionStateOf(health));
}

import { z } from "zod";

/** One panel host; `baseUrl` `""` is the page's own origin. Never carries a token. */
export const hostEntry = z.strictObject({
  name: z.string().min(1),
  baseUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
});

/** The `hosts.json` list: unique names, no extra fields. */
export const hostsFile = z.array(hostEntry).superRefine((hosts, ctx) => {
  const seen = new Set<string>();
  hosts.forEach((host, index) => {
    if (seen.has(host.name)) {
      ctx.addIssue({ code: "custom", path: [index, "name"], message: "name repetido" });
    }
    seen.add(host.name);
  });
});

export type HostEntry = z.infer<typeof hostEntry>;
export type HostsFile = z.infer<typeof hostsFile>;

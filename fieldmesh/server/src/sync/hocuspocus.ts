import { Server } from "@hocuspocus/server";

export const hocuspocus = Server.configure({
  port: 1234,
  async onAuthenticate({ token }) {
    if (!token) throw new Error("unauthorized");
  },
});

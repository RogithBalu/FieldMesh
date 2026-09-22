import type { FastifyInstance } from "fastify";

export async function reportRoutes(app: FastifyInstance) {
  app.get(
    "/inspections/:id/report",
    { onRequest: [(app as any).authenticate] },
    async (req) => {
      const { id } = req.params as { id: string };
      return { inspectionId: id, status: "not_implemented" };
    }
  );
}

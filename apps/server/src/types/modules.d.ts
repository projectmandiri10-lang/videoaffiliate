declare module "@fastify/static" {
  import type { FastifyPluginAsync } from "fastify";
  const plugin: FastifyPluginAsync<Record<string, unknown>>;
  export default plugin;
}

declare module "ffprobe-static" {
  const ffprobe: { path: string };
  export default ffprobe;
}

declare module "ffmpeg-static" {
  const ffmpeg: string;
  export default ffmpeg;
}

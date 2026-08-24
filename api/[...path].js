import { handler } from "../src/server.js";

export default function api(req, res) {
  return handler(req, res);
}

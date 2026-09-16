import { RequestHandler } from "express";
import cors, { CorsOptions } from "cors";

const ALLOWED_ORIGINS: (string | RegExp)[] = [
  "http://localhost:3000",
  "http://localhost:5175",
  "http://localhost:8080",
  /^https:\/\/.*\.tekion\.com$/,
];

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some((pattern) =>
      pattern instanceof RegExp ? pattern.test(origin) : pattern === origin
    );
    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: origin '${origin}' not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "X-Proxy-Target",
  ],
  exposedHeaders: ["X-Proxy-Duration-Ms", "X-Proxy-Status"],
  credentials: true,
  optionsSuccessStatus: 204,
};

export const corsMiddleware: RequestHandler = cors(corsOptions);
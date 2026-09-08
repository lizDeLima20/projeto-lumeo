import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../errors/ApiError.js";

export interface PaymentWebhookEvent {
  id: string;
  timestamp: number;
  type: string;
  payload: unknown;
}

export class PaymentWebhookHandler {
  private readonly processed = new Set<string>();
  public constructor(private readonly secret: string) {}

  public verify(rawBody: string, signature: string): void {
    if (!this.secret) throw new ApiError(503, "WEBHOOK_NOT_CONFIGURED", "Webhook não configurado.");
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const supplied = Buffer.from(signature, "hex");
    const target = Buffer.from(expected, "hex");
    if (supplied.length !== target.length || !timingSafeEqual(supplied, target)) throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "Assinatura inválida.");
  }

  public process(event: PaymentWebhookEvent): "processed" | "duplicate" {
    if (this.processed.has(event.id)) return "duplicate";
    this.processed.add(event.id);
    return "processed";
  }
}

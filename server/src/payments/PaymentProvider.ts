export interface PaymentProvider {
  createCheckout(): Promise<never>;
}

export class DisabledPaymentProvider implements PaymentProvider {
  public async createCheckout(): Promise<never> {
    throw new Error("Payment provider disabled.");
  }
}

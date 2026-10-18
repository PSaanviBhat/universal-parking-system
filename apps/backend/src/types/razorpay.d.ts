declare module 'razorpay' {
  interface RazorpayOptions {
    key_id: string;
    key_secret: string;
  }

  interface OrderCreateArgs {
    amount: number;
    currency: string;
    receipt?: string;
    notes?: Record<string, string>;
  }

  interface RazorpayOrder {
    id: string;
    entity: string;
    amount: number;
    amount_paid: number;
    amount_due: number;
    currency: string;
    receipt: string;
    status: string;
    attempts: number;
    notes: Record<string, string>;
    created_at: number;
  }

  class Razorpay {
    constructor(options: RazorpayOptions);
    orders: {
      create(args: OrderCreateArgs): Promise<RazorpayOrder>;
      fetch(orderId: string): Promise<RazorpayOrder>;
    };
  }

  export default Razorpay;
}

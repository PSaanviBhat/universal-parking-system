import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../providers/auth_provider.dart';
import '../services/wallet_service.dart';

class TopUpScreen extends StatefulWidget {
  const TopUpScreen({super.key});

  @override
  State<TopUpScreen> createState() => _TopUpScreenState();
}

class _TopUpScreenState extends State<TopUpScreen> {
  final _amountController = TextEditingController(text: '100');
  double _selectedAmount = 100.0;
  bool _isLoading = false;
  String? _errorMessage;

  static const double _minimumTopUp = 35;
  final List<double> _presetAmounts = [35, 50, 100, 250, 500];

  Razorpay? _razorpay;
  Completer<PaymentSuccessResponse>? _pendingPayment;

  bool get _checkoutSupported => !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  @override
  void initState() {
    super.initState();
    if (_checkoutSupported) {
      _razorpay = Razorpay()
        ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess)
        ..on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError)
        ..on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
    }
  }

  @override
  void dispose() {
    _razorpay?.clear();
    _amountController.dispose();
    super.dispose();
  }

  void _onPaymentSuccess(PaymentSuccessResponse response) {
    _pendingPayment?.complete(response);
  }

  void _onPaymentError(PaymentFailureResponse response) {
    final cancelled = response.code == Razorpay.PAYMENT_CANCELLED;
    _pendingPayment?.completeError(
      cancelled ? 'Payment cancelled. No money was taken.' : 'Payment failed: ${response.message ?? 'unknown error'}. No money was added.',
    );
  }

  void _onExternalWallet(ExternalWalletResponse response) {
    _pendingPayment?.completeError(
      '${response.walletName ?? 'External wallet'} payments are not supported. Please use UPI, card or netbanking.',
    );
  }

  void _onPresetSelected(double val) {
    setState(() {
      _selectedAmount = val;
      _amountController.text = val.toInt().toString();
      _errorMessage = null;
    });
  }

  /// Opens Razorpay Checkout for the order and waits for its result.
  Future<PaymentSuccessResponse> _collectPayment(Map<String, dynamic> order) {
    final user = Provider.of<AuthProvider>(context, listen: false).user;
    _pendingPayment = Completer<PaymentSuccessResponse>();
    _razorpay!.open({
      'key': order['keyId'],
      'order_id': order['orderId'],
      'amount': order['amountInPaise'],
      'currency': order['currency'] ?? 'INR',
      'name': 'Universal Smart Parking',
      'description': 'Parking wallet top-up',
      'prefill': {
        if (user?['email'] != null) 'email': user!['email'],
        if (user?['phone'] != null) 'contact': user!['phone'],
      },
      'theme': {'color': '#1E3A5F'},
    });
    return _pendingPayment!.future;
  }

  Future<void> _handleTopUp() async {
    final entered = double.tryParse(_amountController.text.trim());
    if (entered == null || entered < _minimumTopUp) {
      setState(() => _errorMessage = 'Minimum top-up amount is ₹${_minimumTopUp.toInt()}.');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // 1. The backend creates (and records) the order; it decides the amount credited.
      final order = await WalletService.createTopUpOrder(entered);
      final orderId = order['orderId'] as String;

      Map<String, dynamic> result;
      if (order['isMock'] == true) {
        // Local development only (backend has ALLOW_SIMULATED_PAYMENTS=true and no Razorpay keys).
        result = await WalletService.topUp(razorpayOrderId: orderId);
      } else {
        if (!_checkoutSupported) {
          throw 'Online payments are only available in the Android and iOS apps.';
        }
        // 2. Razorpay Checkout collects the payment.
        final payment = await _collectPayment(order);
        // 3. The backend verifies the signature and the payment with Razorpay, then credits the wallet.
        result = await WalletService.topUp(
          razorpayOrderId: payment.orderId ?? orderId,
          razorpayPaymentId: payment.paymentId,
          razorpaySignature: payment.signature,
        );
      }

      if (!mounted) return;
      final credited = (result['amountCredited'] as num?)?.toDouble() ?? entered;
      final reinstated = result['isReinstated'] == true;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            reinstated
                ? 'Added ₹${credited.toStringAsFixed(2)}. Your dues are cleared and your account is active again.'
                : 'Added ₹${credited.toStringAsFixed(2)} to your wallet!',
          ),
          backgroundColor: const Color(0xFF10B981),
        ),
      );
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      });
    } finally {
      _pendingPayment = null;
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Add Money to Wallet'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Enter Top-Up Amount',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 6),
              const Text(
                'Funds are instantly available for parking entry & automated barrier checkout.',
                style: TextStyle(color: Colors.black54, fontSize: 13),
              ),
              const SizedBox(height: 28),
              if (_errorMessage != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 20),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.error_outline, color: Colors.red.shade700, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(_errorMessage!, style: TextStyle(color: Colors.red.shade800, fontSize: 13)),
                      ),
                    ],
                  ),
                ),
              TextField(
                controller: _amountController,
                keyboardType: TextInputType.number,
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                decoration: InputDecoration(
                  prefixText: '₹ ',
                  prefixStyle: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                  labelText: 'Amount (INR)',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
                  filled: true,
                  fillColor: Colors.grey.shade50,
                ),
                onChanged: (val) {
                  final parsed = double.tryParse(val);
                  if (parsed != null) setState(() => _selectedAmount = parsed);
                },
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: _presetAmounts.map((preset) {
                  final isSelected = _selectedAmount == preset;
                  return ChoiceChip(
                    label: Text(
                      '+ ₹${preset.toInt()}',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isSelected ? Colors.white : const Color(0xFF0F172A),
                      ),
                    ),
                    selected: isSelected,
                    selectedColor: const Color(0xFF1E3A5F),
                    backgroundColor: Colors.grey.shade100,
                    onSelected: (_) => _onPresetSelected(preset),
                  );
                }).toList(),
              ),
              const SizedBox(height: 36),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFBFDBFE)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.verified_user_rounded, color: Color(0xFF2563EB), size: 24),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Secured by Razorpay • UPI, cards & netbanking • Minimum top-up is ₹35.',
                        style: TextStyle(color: Color(0xFF1E40AF), fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _handleTopUp,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1E3A5F),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    elevation: 0,
                  ),
                  child: _isLoading
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : const Text('Proceed to Pay', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

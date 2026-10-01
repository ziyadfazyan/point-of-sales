<?php

namespace App\Http\Controllers\Apps;

use App\Exceptions\PrinterConnectionException;
use App\Http\Controllers\Controller;
use App\Models\Transaction;
use App\Services\OutletAccessService;
use App\Services\PrinterSettingsService;
use App\Services\Printing\ThermalPrinterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PrinterController extends Controller
{
    public function __construct(
        private readonly OutletAccessService $outletAccessService,
        private readonly PrinterSettingsService $printerSettingsService,
        private readonly ThermalPrinterService $thermalPrinterService,
    ) {}

    public function test(Request $request, string $printer): JsonResponse
    {
        $outlet = $this->outletAccessService->activeOutlet($request);
        $profile = $this->printerSettingsService->find($outlet, $printer);
        abort_unless($profile, 404, 'Printer tidak ditemukan.');

        try {
            return response()->json($this->thermalPrinterService->test($profile));
        } catch (PrinterConnectionException $exception) {
            return $this->printerError($exception);
        }
    }

    public function printReceipt(Request $request, string $invoice): JsonResponse
    {
        $validated = $request->validate([
            'printer_id' => ['nullable', 'string', 'max:80'],
        ]);

        $transaction = Transaction::query()
            ->with('details.product', 'details.pricingRule', 'cashier', 'customer', 'warehouse.outlet', 'tenders')
            ->where('invoice', $invoice)
            ->firstOrFail();

        abort_unless($this->outletAccessService->canUseWarehouse($request->user(), $transaction->warehouse), 404);

        $outlet = $transaction->warehouse?->outlet ?? $this->outletAccessService->activeOutlet($request);
        $profile = $this->printerSettingsService->find($outlet, $validated['printer_id'] ?? null);
        abort_unless($profile, 404, 'Printer tidak ditemukan.');

        try {
            return response()->json($this->thermalPrinterService->printTransaction($transaction, $profile));
        } catch (PrinterConnectionException $exception) {
            return $this->printerError($exception);
        }
    }

    private function printerError(PrinterConnectionException $exception): JsonResponse
    {
        $status = $exception->reason === 'invalid_configuration' ? 422 : 503;

        return response()->json([
            'ok' => false,
            'reason' => $exception->reason,
            'message' => $exception->getMessage(),
        ], $status);
    }
}

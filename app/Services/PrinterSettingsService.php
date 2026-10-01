<?php

namespace App\Services;

use App\Models\Outlet;
use App\Models\Setting;
use Illuminate\Support\Str;

class PrinterSettingsService
{
    public const TYPES = ['lan', 'usb', 'bluetooth_ble', 'system'];

    public function payload(?Outlet $outlet): array
    {
        $rawProfiles = Setting::getForOutlet('printer_profiles', $outlet);
        $paperSize = Setting::getForOutlet('printer_paper_size', $outlet, '80mm');
        $printers = $rawProfiles === null
            ? $this->legacyPrinters($paperSize)
            : $this->normalizePrinters(json_decode((string) $rawProfiles, true) ?: []);

        $defaultId = Setting::getForOutlet('printer_default_id', $outlet);
        if (! $defaultId && $printers !== []) {
            $defaultId = $printers[0]['id'];
        }

        $defaultPrinter = collect($printers)->firstWhere('id', $defaultId);

        return [
            'autoPrint' => Setting::getBoolForOutlet('printer_auto_print', $outlet, false),
            'paperSize' => $defaultPrinter['paper_size'] ?? $paperSize,
            'defaultPrinterId' => $defaultPrinter['id'] ?? null,
            'defaultPrinter' => $defaultPrinter,
            'printers' => $printers,
        ];
    }

    public function find(?Outlet $outlet, ?string $id = null): ?array
    {
        $payload = $this->payload($outlet);
        if (! $id) {
            return $payload['defaultPrinter'];
        }

        return collect($payload['printers'])->firstWhere('id', $id);
    }

    public function persist(?Outlet $outlet, array $values): void
    {
        $printers = $this->normalizePrinters($values['printers'] ?? []);
        $defaultId = $values['printer_default_id'] ?? null;
        if (! collect($printers)->contains('id', $defaultId)) {
            $defaultId = $printers[0]['id'] ?? null;
        }

        $paperSize = collect($printers)->firstWhere('id', $defaultId)['paper_size']
            ?? ($values['printer_paper_size'] ?? '80mm');

        Setting::setForOutlet('printer_auto_print', ! empty($values['printer_auto_print']) ? '1' : '0', $outlet, 'Auto-print receipt setelah transaksi');
        Setting::setForOutlet('printer_paper_size', $paperSize, $outlet, 'Ukuran kertas printer thermal');
        Setting::setForOutlet('printer_default_id', $defaultId, $outlet, 'Printer default untuk transaksi POS');
        Setting::setForOutlet('printer_profiles', json_encode($printers), $outlet, 'Daftar konfigurasi printer POS');
    }

    public function normalizePrinters(array $printers): array
    {
        return collect($printers)
            ->filter(fn ($printer) => is_array($printer))
            ->map(function (array $printer) {
                $type = $this->normalizeType($printer['type'] ?? null);
                $config = is_array($printer['config'] ?? null) ? $printer['config'] : [];

                return [
                    'id' => $this->normalizeId($printer['id'] ?? null),
                    'name' => Str::limit(trim((string) ($printer['name'] ?? 'Printer')), 80, ''),
                    'type' => $type,
                    'is_active' => filter_var($printer['is_active'] ?? true, FILTER_VALIDATE_BOOL),
                    'paper_size' => ($printer['paper_size'] ?? null) === '58mm' ? '58mm' : '80mm',
                    'host' => $this->normalizeHost($printer['host'] ?? $config['host'] ?? ''),
                    'port' => max(1, min(65535, (int) ($printer['port'] ?? $config['port'] ?? 9100))),
                    'timeout_ms' => max(500, min(30000, (int) ($printer['timeout_ms'] ?? $config['timeout_ms'] ?? 5000))),
                    'config' => $this->normalizeConfig($type, $config),
                ];
            })
            ->values()
            ->all();
    }

    private function legacyPrinters(string $paperSize): array
    {
        return [[
            'id' => 'usb-default',
            'name' => 'Thermal USB',
            'type' => 'usb',
            'is_active' => true,
            'paper_size' => $paperSize === '58mm' ? '58mm' : '80mm',
            'host' => '',
            'port' => 9100,
            'timeout_ms' => 5000,
            'config' => [],
        ]];
    }

    private function normalizeId(?string $id): string
    {
        $id = trim((string) $id);

        return preg_match('/^[A-Za-z0-9_-]{3,80}$/', $id) ? $id : (string) Str::uuid();
    }

    private function normalizeConfig(string $type, array $config): array
    {
        return match ($type) {
            'bluetooth_ble' => [
                'service_uuid' => trim((string) ($config['service_uuid'] ?? '')),
                'characteristic_uuid' => trim((string) ($config['characteristic_uuid'] ?? '')),
            ],
            default => [],
        };
    }

    private function normalizeType(?string $type): string
    {
        return match ($type) {
            'network' => 'lan',
            'bluetooth' => 'bluetooth_ble',
            'lan', 'usb', 'bluetooth_ble', 'system' => $type,
            default => 'system',
        };
    }

    private function normalizeHost(mixed $host): string
    {
        return trim((string) $host);
    }
}

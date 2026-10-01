<?php

namespace Tests\Feature\Printing;

use App\Exceptions\PrinterConnectionException;
use App\Models\Outlet;
use App\Models\Setting;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\PrinterSettingsService;
use App\Services\Printing\EscposReceiptGenerator;
use App\Services\Printing\ThermalPrinterService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

class ThermalPrinterServiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_lan_printer_configuration_is_selected_by_registered_id(): void
    {
        $outlet = Outlet::create(['code' => 'MAL', 'name' => 'Malabar']);
        Setting::setForOutlet('printer_profiles', json_encode([
            [
                'id' => 'kasir-1',
                'name' => 'Kasir 1',
                'type' => 'lan',
                'host' => '192.168.1.50',
                'port' => 9100,
                'paper_size' => '80mm',
                'is_active' => true,
            ],
            [
                'id' => 'kitchen',
                'name' => 'Kitchen',
                'type' => 'lan',
                'host' => '192.168.1.52',
                'port' => 9100,
                'paper_size' => '58mm',
                'is_active' => true,
            ],
        ]), $outlet);

        $printer = app(PrinterSettingsService::class)->find($outlet, 'kitchen');

        $this->assertSame('Kitchen', $printer['name']);
        $this->assertSame('lan', $printer['type']);
        $this->assertSame('192.168.1.52', $printer['host']);
        $this->assertSame('58mm', $printer['paper_size']);
    }

    public function test_successful_tcp_send_writes_escpos_data(): void
    {
        $service = $this->fakePrinterService();

        $transaction = new Transaction([
            'invoice' => 'INV-PRINT-1',
            'cash' => 10000,
            'change' => 0,
            'discount' => 0,
            'grand_total' => 10000,
        ]);
        $transaction->setRelation('details', collect());
        $transaction->setRelation('tenders', collect());

        $service->printTransaction($transaction, $this->printerProfile());

        $this->assertSame('192.168.1.50', $service->sent[0]['host']);
        $this->assertSame(9100, $service->sent[0]['port']);
        $this->assertSame(5.0, $service->sent[0]['timeout']);
        $this->assertStringStartsWith("\x1B\x40", $service->sent[0]['payload']);
        $this->assertStringContainsString('INV-PRINT-1', $service->sent[0]['payload']);
        $this->assertStringEndsWith("\x1D\x56\x42\x00", $service->sent[0]['payload']);
    }

    public function test_connection_timeout_returns_clear_reason(): void
    {
        $this->expectException(PrinterConnectionException::class);
        $this->expectExceptionMessage('Koneksi printer timeout.');

        $this->fakePrinterService(new PrinterConnectionException('Koneksi printer timeout.', 'timeout'))
            ->testConnection($this->printerProfile());
    }

    public function test_connection_refused_returns_clear_reason(): void
    {
        try {
            $this->fakePrinterService(new PrinterConnectionException('Koneksi printer ditolak.', 'connection_refused'))
                ->testConnection($this->printerProfile());
            $this->fail('Expected printer exception.');
        } catch (PrinterConnectionException $exception) {
            $this->assertSame('connection_refused', $exception->reason);
            $this->assertSame('Koneksi printer ditolak.', $exception->getMessage());
        }
    }

    public function test_invalid_printer_configuration_is_rejected(): void
    {
        $this->expectException(PrinterConnectionException::class);
        $this->expectExceptionMessage('Host/IP printer LAN belum dikonfigurasi.');

        app(ThermalPrinterService::class)->testConnection([
            ...$this->printerProfile(),
            'host' => '',
        ]);
    }

    public function test_test_endpoint_rejects_unknown_printer_id(): void
    {
        $outlet = Outlet::create(['code' => 'MAL', 'name' => 'Malabar']);
        $user = User::factory()->create();
        $user->markEmailAsVerified();
        $user->givePermissionTo(Permission::firstOrCreate(['name' => 'dashboard-access', 'guard_name' => 'web']));
        $user->outlets()->attach($outlet->id, ['is_default' => true]);

        $this->actingAs($user)
            ->postJson(route('settings.printer.test', 'missing-printer'))
            ->assertNotFound();
    }

    public function test_print_endpoint_uses_registered_printer_id_not_request_host(): void
    {
        $service = $this->fakePrinterService();
        $this->app->instance(ThermalPrinterService::class, $service);

        $outlet = Outlet::create(['code' => 'MAL', 'name' => 'Malabar']);
        $warehouse = Warehouse::create([
            'code' => 'MAL',
            'name' => 'Malabar',
            'type' => 'branch',
            'outlet_id' => $outlet->id,
            'is_active' => true,
        ]);
        $user = User::factory()->create();
        $user->markEmailAsVerified();
        $user->givePermissionTo(Permission::firstOrCreate(['name' => 'transactions-access', 'guard_name' => 'web']));
        $user->outlets()->attach($outlet->id, ['is_default' => true]);
        Setting::setForOutlet('printer_profiles', json_encode([$this->printerProfile()]), $outlet);

        $transaction = Transaction::create([
            'cashier_id' => $user->id,
            'invoice' => 'INV-ENDPOINT-1',
            'cash' => 10000,
            'change' => 0,
            'discount' => 0,
            'grand_total' => 10000,
            'warehouse_id' => $warehouse->id,
        ]);
        $transaction->setRelation('details', new Collection);

        $this->actingAs($user)
            ->postJson(route('transactions.print.thermal', $transaction->invoice), [
                'printer_id' => 'kasir-1',
                'host' => '10.10.10.10',
                'port' => 1,
            ])
            ->assertOk();

        $this->assertSame('192.168.1.50', $service->sent[0]['host']);
        $this->assertSame(9100, $service->sent[0]['port']);
    }

    private function fakePrinterService(?PrinterConnectionException $exception = null): TestThermalPrinterService
    {
        return new TestThermalPrinterService(app(EscposReceiptGenerator::class), $exception);
    }

    private function printerProfile(): array
    {
        return [
            'id' => 'kasir-1',
            'name' => 'Kasir 1',
            'type' => 'lan',
            'host' => '192.168.1.50',
            'port' => 9100,
            'paper_size' => '80mm',
            'timeout_ms' => 5000,
            'is_active' => true,
        ];
    }
}

class TestThermalPrinterService extends ThermalPrinterService
{
    public array $sent = [];

    public function __construct(
        EscposReceiptGenerator $receiptGenerator,
        private readonly ?PrinterConnectionException $exception = null
    ) {
        parent::__construct($receiptGenerator);
    }

    protected function sendRaw(string $host, int $port, float $timeoutSeconds, string $payload): int
    {
        if ($this->exception) {
            throw $this->exception;
        }

        $this->sent[] = [
            'host' => $host,
            'port' => $port,
            'timeout' => $timeoutSeconds,
            'payload' => $payload,
        ];

        return strlen($payload);
    }

    protected function openSocket(string $host, int $port, float $timeoutSeconds)
    {
        if ($this->exception) {
            throw $this->exception;
        }

        return fopen('php://temp', 'r+');
    }
}

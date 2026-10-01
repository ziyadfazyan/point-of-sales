<?php

namespace App\Services\Printing;

use App\Exceptions\PrinterConnectionException;
use App\Models\Transaction;

class ThermalPrinterService
{
    public function __construct(private readonly EscposReceiptGenerator $receiptGenerator) {}

    public function test(array $printer): array
    {
        $this->ensureLanPrinter($printer);
        $this->sendRaw(
            $printer['host'],
            $printer['port'],
            $this->timeoutSeconds($printer),
            $this->receiptGenerator->testReceipt($printer['name'] ?? 'TEST PRINT', $printer['paper_size'] ?? '80mm')
        );

        return [
            'ok' => true,
            'message' => 'Test print terkirim ke printer LAN.',
        ];
    }

    public function printTransaction(Transaction $transaction, array $printer): array
    {
        $this->ensureLanPrinter($printer);
        $bytes = $this->receiptGenerator->transaction($transaction, $printer['paper_size'] ?? '80mm');
        $written = $this->sendRaw(
            $printer['host'],
            $printer['port'],
            $this->timeoutSeconds($printer),
            $bytes
        );

        return [
            'ok' => true,
            'bytes' => $written,
            'message' => 'Struk terkirim ke printer LAN.',
        ];
    }

    public function testConnection(array $printer): array
    {
        $this->ensureLanPrinter($printer);
        $socket = $this->openSocket($printer['host'], $printer['port'], $this->timeoutSeconds($printer));
        fclose($socket);

        return [
            'ok' => true,
            'message' => 'Printer LAN dapat dihubungi.',
        ];
    }

    private function ensureLanPrinter(array $printer): void
    {
        if (($printer['type'] ?? null) !== 'lan') {
            throw new PrinterConnectionException('Printer yang dipilih bukan printer LAN.', 'invalid_configuration');
        }

        if (! ($printer['is_active'] ?? false)) {
            throw new PrinterConnectionException('Printer tidak aktif.', 'invalid_configuration');
        }

        if (trim((string) ($printer['host'] ?? '')) === '') {
            throw new PrinterConnectionException('Host/IP printer LAN belum dikonfigurasi.', 'invalid_configuration');
        }

        if (! $this->validHost($printer['host'])) {
            throw new PrinterConnectionException('Host/IP printer LAN tidak valid.', 'invalid_configuration');
        }

        $port = (int) ($printer['port'] ?? 0);
        if ($port < 1 || $port > 65535) {
            throw new PrinterConnectionException('Port printer LAN tidak valid.', 'invalid_configuration');
        }
    }

    private function validHost(string $host): bool
    {
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return true;
        }

        return (bool) preg_match('/^(?=.{1,253}$)(?!-)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.?$/', $host);
    }

    private function timeoutSeconds(array $printer): float
    {
        return max(0.5, min(30, ((int) ($printer['timeout_ms'] ?? 5000)) / 1000));
    }

    protected function sendRaw(string $host, int $port, float $timeoutSeconds, string $payload): int
    {
        $socket = $this->openSocket($host, $port, $timeoutSeconds);
        stream_set_timeout($socket, (int) $timeoutSeconds, (int) (($timeoutSeconds - (int) $timeoutSeconds) * 1_000_000));

        $written = 0;
        $length = strlen($payload);
        while ($written < $length) {
            $chunk = fwrite($socket, substr($payload, $written));
            if ($chunk === false || $chunk === 0) {
                fclose($socket);

                throw new PrinterConnectionException('Gagal mengirim data ke printer LAN.', 'write_failed');
            }

            $written += $chunk;
            $meta = stream_get_meta_data($socket);
            if ($meta['timed_out'] ?? false) {
                fclose($socket);

                throw new PrinterConnectionException('Koneksi printer timeout saat mengirim data.', 'timeout');
            }
        }

        fclose($socket);

        return $written;
    }

    /**
     * @return resource
     */
    protected function openSocket(string $host, int $port, float $timeoutSeconds)
    {
        $errno = 0;
        $errstr = '';
        $socket = @stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, $timeoutSeconds, STREAM_CLIENT_CONNECT);

        if ($socket === false) {
            throw new PrinterConnectionException(
                $this->socketErrorMessage($errno, $errstr),
                $this->socketErrorReason($errno, $errstr),
                $errno
            );
        }

        return $socket;
    }

    private function socketErrorMessage(int $errno, string $errstr): string
    {
        $error = strtolower($errstr);

        if (str_contains($error, 'timed out') || $errno === 110) {
            return 'Koneksi printer timeout. Periksa IP, port, dan jaringan printer.';
        }

        if (str_contains($error, 'refused') || in_array($errno, [61, 111], true)) {
            return 'Koneksi printer ditolak. Periksa port printer atau firewall.';
        }

        if (str_contains($error, 'getaddrinfo') || str_contains($error, 'name or service') || str_contains($error, 'nodename')) {
            return 'Hostname printer tidak ditemukan.';
        }

        if (str_contains($error, 'unreachable') || in_array($errno, [65, 101, 113], true)) {
            return 'Printer tidak bisa dijangkau dari server Laravel.';
        }

        return $errstr !== '' ? "Koneksi printer gagal: {$errstr}" : 'Koneksi printer gagal.';
    }

    private function socketErrorReason(int $errno, string $errstr): string
    {
        $error = strtolower($errstr);

        if (str_contains($error, 'timed out') || $errno === 110) {
            return 'timeout';
        }

        if (str_contains($error, 'refused') || in_array($errno, [61, 111], true)) {
            return 'connection_refused';
        }

        if (str_contains($error, 'getaddrinfo') || str_contains($error, 'name or service') || str_contains($error, 'nodename')) {
            return 'dns_failed';
        }

        if (str_contains($error, 'unreachable') || in_array($errno, [65, 101, 113], true)) {
            return 'host_unreachable';
        }

        return 'connection_failed';
    }
}

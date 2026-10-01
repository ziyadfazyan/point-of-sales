<?php

namespace App\Services\Printing;

use App\Models\Transaction;
use App\Services\ThermalPrintService;

class EscposReceiptGenerator
{
    public function __construct(private readonly ThermalPrintService $thermalPrintService) {}

    public function transaction(Transaction $transaction, string $paperSize = '80mm'): string
    {
        $text = $this->thermalPrintService->generateReceiptText($transaction, $paperSize);

        return $this->wrapEscpos($text);
    }

    public function testReceipt(string $name = 'TEST PRINT', string $paperSize = '80mm'): string
    {
        $width = $paperSize === '58mm' ? 32 : 48;
        $lines = [
            $this->center($name, $width),
            str_repeat('-', $width),
            'Laravel POS printer test',
            'Time: '.now()->format('d/m/Y H:i:s'),
            str_repeat('-', $width),
            $this->center('OK', $width),
            '',
            '',
        ];

        return $this->wrapEscpos(implode("\n", $lines));
    }

    private function wrapEscpos(string $text): string
    {
        return "\x1B\x40".$text."\n\n\x1D\x56\x42\x00";
    }

    private function center(string $text, int $width): string
    {
        $text = mb_substr($text, 0, $width);
        $pad = max(0, (int) floor(($width - mb_strlen($text)) / 2));

        return str_repeat(' ', $pad).$text;
    }
}

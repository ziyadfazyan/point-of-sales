<?php

namespace App\Exceptions;

use RuntimeException;

class PrinterConnectionException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $reason = 'connection_failed',
        int $code = 0,
        ?\Throwable $previous = null
    ) {
        parent::__construct($message, $code, $previous);
    }
}

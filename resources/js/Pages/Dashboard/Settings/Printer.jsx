import React, { useMemo, useState } from "react";
import DashboardLayout from "@/Layouts/DashboardLayout";
import { Head, useForm } from "@inertiajs/react";
import toast from "react-hot-toast";
import {
    IconBluetooth,
    IconDeviceFloppy,
    IconNetwork,
    IconPlugConnected,
    IconPlus,
    IconPrinter,
    IconTrash,
    IconUsb,
} from "@tabler/icons-react";
import { PrinterManager } from "@/Utils/escpos";

const typeOptions = [
    { value: "usb", label: "USB / WebUSB", icon: IconUsb },
    { value: "lan", label: "LAN / Ethernet", icon: IconNetwork },
    { value: "bluetooth_ble", label: "Bluetooth BLE", icon: IconBluetooth },
    { value: "system", label: "System printer", icon: IconPrinter },
];

const inputClass = "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function makeId() {
    return crypto?.randomUUID?.() || `printer-${Date.now()}`;
}

function blankPrinter(type = "usb") {
    return {
        id: makeId(),
        name: type === "lan" ? "Printer LAN" : "Printer Thermal",
        type,
        is_active: true,
        paper_size: "80mm",
        host: "",
        port: 9100,
        timeout_ms: 5000,
        config: {},
    };
}

export default function Printer({ settings }) {
    const initialPrinters = settings.printers?.length ? settings.printers : [blankPrinter("usb")];
    const { data, setData, post, processing, errors } = useForm({
        printer_auto_print: settings.autoPrint || false,
        printer_paper_size: settings.paperSize || "80mm",
        printer_default_id: settings.defaultPrinterId || initialPrinters[0]?.id || null,
        printers: initialPrinters,
    });
    const [busyPrinterId, setBusyPrinterId] = useState(null);

    const manager = useMemo(
        () => new PrinterManager(data.printers, data.printer_default_id),
        [data.printers, data.printer_default_id]
    );

    const setPrinters = (printers) => {
        const nextDefault = printers.some((printer) => printer.id === data.printer_default_id)
            ? data.printer_default_id
            : printers[0]?.id || null;
        setData({
            ...data,
            printers,
            printer_default_id: nextDefault,
            printer_paper_size: printers.find((printer) => printer.id === nextDefault)?.paper_size || data.printer_paper_size,
        });
    };

    const updatePrinter = (id, patch) => {
        setPrinters(data.printers.map((printer) => (
            printer.id === id ? { ...printer, ...patch } : printer
        )));
    };

    const updateConfig = (id, key, value) => {
        setPrinters(data.printers.map((printer) => (
            printer.id === id
                ? { ...printer, config: { ...(printer.config || {}), [key]: value } }
                : printer
        )));
    };

    const updateConnection = (id, key, value) => {
        setPrinters(data.printers.map((printer) => (
            printer.id === id ? { ...printer, [key]: value } : printer
        )));
    };

    const addPrinter = (type) => {
        const printer = blankPrinter(type);
        setPrinters([...data.printers, printer]);
    };

    const removePrinter = (id) => {
        setPrinters(data.printers.filter((printer) => printer.id !== id));
    };

    const selectDefault = (printer) => {
        setData({
            ...data,
            printer_default_id: printer.id,
            printer_paper_size: printer.paper_size,
        });
    };

    const handleTest = async (printer) => {
        setBusyPrinterId(printer.id);
        try {
            await manager.testConnection(printer, { systemPrint: () => window.print() });
            toast.success("Test koneksi printer berhasil.");
        } catch (error) {
            toast.error(error.message || "Test koneksi printer gagal.");
        } finally {
            setBusyPrinterId(null);
        }
    };

    const submit = (e) => {
        e.preventDefault();
        post(route("settings.printer.update"), {
            preserveScroll: true,
            onSuccess: () => toast.success("Pengaturan printer disimpan"),
            onError: () => toast.error("Gagal menyimpan pengaturan printer"),
        });
    };

    return (
        <>
            <Head title="Pengaturan Printer" />
            <div className="space-y-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <IconPrinter size={28} className="text-primary-500" />
                            Pengaturan Printer
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Kelola printer thermal USB, LAN, Bluetooth BLE, dan fallback system printer.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => addPrinter("usb")}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
                    >
                        <IconPlus size={18} />
                        Tambah Printer
                    </button>
                </div>

                <form onSubmit={submit} className="space-y-5">
                    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={data.printer_auto_print}
                                onChange={(e) => setData("printer_auto_print", e.target.checked)}
                                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                            />
                            Cetak otomatis setelah transaksi memakai printer default jika koneksi mendukung.
                        </label>
                        <button
                            type="submit"
                            disabled={processing}
                            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-medium transition-colors disabled:opacity-50"
                        >
                            <IconDeviceFloppy size={18} />
                            {processing ? "Menyimpan..." : "Simpan"}
                        </button>
                    </div>

                    {errors.printers && <p className="text-sm text-danger-600">{errors.printers}</p>}

                    <div className="grid gap-4">
                        {data.printers.map((printer, index) => {
                            const typeMeta = typeOptions.find((type) => type.value === printer.type) || typeOptions[3];
                            const TypeIcon = typeMeta.icon;
                            const isDefault = data.printer_default_id === printer.id;

                            return (
                                <div key={printer.id} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-10 w-10 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-300 flex items-center justify-center">
                                                <TypeIcon size={21} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-semibold text-slate-900 dark:text-white truncate">{printer.name || `Printer ${index + 1}`}</p>
                                                <p className="text-xs text-slate-500">{typeMeta.label} {isDefault ? "• Default" : ""} {!printer.is_active ? "• Nonaktif" : ""}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => selectDefault(printer)}
                                                className={`px-3 py-2 rounded-lg border text-sm font-medium ${isDefault ? "border-success-300 bg-success-50 text-success-700" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                                            >
                                                Default
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleTest(printer)}
                                                disabled={busyPrinterId === printer.id}
                                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-primary-300 text-primary-700 hover:bg-primary-50 dark:border-primary-800 dark:text-primary-300 dark:hover:bg-primary-950/30 text-sm font-medium disabled:opacity-50"
                                            >
                                                <IconPlugConnected size={17} />
                                                {busyPrinterId === printer.id ? "Testing..." : "Test"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removePrinter(printer.id)}
                                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-danger-300 text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-950/30 text-sm font-medium"
                                            >
                                                <IconTrash size={17} />
                                                Hapus
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        <Field label="Nama">
                                            <input value={printer.name} onChange={(e) => updatePrinter(printer.id, { name: e.target.value })} className={inputClass} />
                                        </Field>
                                        <Field label="Tipe">
                                            <select
                                                value={printer.type}
                                                onChange={(e) => updatePrinter(printer.id, { ...blankPrinter(e.target.value), id: printer.id, name: printer.name })}
                                                className={inputClass}
                                            >
                                                {typeOptions.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                                            </select>
                                        </Field>
                                        <Field label="Ukuran kertas">
                                            <select value={printer.paper_size} onChange={(e) => updatePrinter(printer.id, { paper_size: e.target.value })} className={inputClass}>
                                                <option value="80mm">80 mm</option>
                                                <option value="58mm">58 mm</option>
                                            </select>
                                        </Field>
                                        <Field label="Status">
                                            <select value={printer.is_active ? "1" : "0"} onChange={(e) => updatePrinter(printer.id, { is_active: e.target.value === "1" })} className={inputClass}>
                                                <option value="1">Aktif</option>
                                                <option value="0">Nonaktif</option>
                                            </select>
                                        </Field>
                                        {printer.type === "lan" && (
                                            <Field label="Port TCP">
                                                <input type="number" min="1" max="65535" value={printer.port || 9100} onChange={(e) => updateConnection(printer.id, "port", Number(e.target.value))} className={inputClass} />
                                            </Field>
                                        )}
                                    </div>

                                    {printer.type === "lan" && (
                                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                            <Field label="IP / hostname">
                                                <input value={printer.host || ""} onChange={(e) => updateConnection(printer.id, "host", e.target.value)} placeholder="192.168.1.50" className={inputClass} />
                                            </Field>
                                            <Field label="Timeout">
                                                <input type="number" min="500" max="30000" value={printer.timeout_ms || 5000} onChange={(e) => updateConnection(printer.id, "timeout_ms", Number(e.target.value))} className={inputClass} />
                                            </Field>
                                        </div>
                                    )}

                                    {printer.type === "bluetooth_ble" && (
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <Field label="Service UUID">
                                                <input value={printer.config?.service_uuid || ""} onChange={(e) => updateConfig(printer.id, "service_uuid", e.target.value)} className={inputClass} />
                                            </Field>
                                            <Field label="Characteristic UUID">
                                                <input value={printer.config?.characteristic_uuid || ""} onChange={(e) => updateConfig(printer.id, "characteristic_uuid", e.target.value)} className={inputClass} />
                                            </Field>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </form>
            </div>
        </>
    );
}

function Field({ label, children }) {
    return (
        <label className="block text-sm">
            <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-2">{label}</span>
            {children}
        </label>
    );
}

Printer.layout = (page) => <DashboardLayout children={page} />;

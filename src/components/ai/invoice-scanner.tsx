"use client";

import { useState, useRef, useCallback } from "react";
import {
  Camera, Upload, X, Check, AlertTriangle, Loader2,
  FileText, Trash2, Edit3, Sparkles, ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { recognizeText, parseInvoiceText, type ParsedInvoice, type ParsedLineItem } from "@/lib/ocr-engine";

// ─── Types ───────────────────────────────────────────────────────────
interface ScannedItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  confidence: "high" | "medium" | "low";
  selected: boolean;
}

interface InvoiceScannerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { name: string; quantity: number; unitCost: number }[], meta: {
    supplierName: string | null;
    invoiceNumber: string | null;
    date: string | null;
  }) => void;
}

// ─── Component ───────────────────────────────────────────────────────
export default function InvoiceScanner({ open, onClose, onConfirm }: InvoiceScannerProps) {
  const [step, setStep] = useState<"upload" | "processing" | "review">("upload");
  const [progress, setProgress] = useState(0);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsedInvoice, setParsedInvoice] = useState<ParsedInvoice | null>(null);
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Reset ─────────────────────────────────────────────────────
  const reset = () => {
    setStep("upload");
    setProgress(0);
    setImagePreview(null);
    setParsedInvoice(null);
    setItems([]);
    setEditingId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ─── File Selection ────────────────────────────────────────────
  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (JPG, PNG, etc.)");
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);

    // Start OCR
    setStep("processing");
    setProgress(0);

    try {
      const { text, confidence } = await recognizeText(file, (p) => setProgress(p));
      const invoice = parseInvoiceText(text);
      invoice.confidence = Math.round(confidence);
      setParsedInvoice(invoice);

      // Convert to editable items
      setItems(
        invoice.items.map((item) => ({
          ...item,
          selected: item.confidence !== "low",
        }))
      );

      setStep("review");

      if (invoice.items.length === 0) {
        toast.warning("No line items detected. You can try a clearer image or add items manually.");
      } else {
        toast.success(`Found ${invoice.items.length} item(s) from invoice!`);
      }
    } catch (err: any) {
      toast.error("OCR processing failed: " + (err.message || "Unknown error"));
      setStep("upload");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  // ─── Item Editing ──────────────────────────────────────────────
  const toggleItem = (id: string) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  };

  const updateItem = (id: string, field: keyof ScannedItem, value: any) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === "quantity" || field === "unitPrice") {
          updated.total = updated.quantity * updated.unitPrice;
        }
        return updated;
      })
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // ─── Confirm ───────────────────────────────────────────────────
  const handleConfirm = () => {
    const selectedItems = items.filter((i) => i.selected);
    if (selectedItems.length === 0) {
      toast.error("Select at least one item to import");
      return;
    }

    onConfirm(
      selectedItems.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitCost: i.unitPrice,
      })),
      {
        supplierName: parsedInvoice?.supplierName || null,
        invoiceNumber: parsedInvoice?.invoiceNumber || null,
        date: parsedInvoice?.date || null,
      }
    );

    toast.success(`${selectedItems.length} item(s) imported to purchase form!`);
    handleClose();
  };

  const confidenceBadge = (c: "high" | "medium" | "low") => {
    switch (c) {
      case "high": return <Badge variant="default" className="bg-emerald-500 text-[10px]">High</Badge>;
      case "medium": return <Badge variant="secondary" className="bg-amber-500 text-white text-[10px]">Medium</Badge>;
      case "low": return <Badge variant="destructive" className="text-[10px]">Low</Badge>;
    }
  };

  // ─── Render ────────────────────────────────────────────────────
  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          AI Invoice Scanner
        </DialogTitle>
      </DialogHeader>

      <div className="max-h-[70vh] overflow-y-auto">
        {/* ─── Step 1: Upload ─────────────────────────────────── */}
        {step === "upload" && (
          <div className="p-6 space-y-4">
            <Alert className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
              <Sparkles className="h-4 w-4 text-purple-600" />
              <AlertTitle className="text-purple-800 dark:text-purple-300">Smart Scanner</AlertTitle>
              <AlertDescription className="text-purple-700/80 dark:text-purple-300/80 text-xs mt-1">
                Take a photo or upload an image of a supplier invoice. The AI will automatically extract item names, quantities, and rates.
              </AlertDescription>
            </Alert>

            <div
              className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-12 text-center hover:border-purple-400 transition-colors cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Camera className="h-8 w-8 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Drop invoice image here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports JPG, PNG, WebP • Max 10MB</p>
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" /> Upload Image
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  // Trigger camera on mobile
                  if (fileInputRef.current) {
                    fileInputRef.current.setAttribute("capture", "environment");
                    fileInputRef.current.click();
                  }
                }}
              >
                <Camera className="h-4 w-4 mr-2" /> Take Photo
              </Button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Processing ─────────────────────────────── */}
        {step === "processing" && (
          <div className="p-6 space-y-6">
            {imagePreview && (
              <div className="relative rounded-lg overflow-hidden border max-h-48">
                <img src={imagePreview} alt="Invoice" className="w-full h-48 object-cover opacity-50" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="text-center text-white">
                    <Loader2 className="h-10 w-10 animate-spin mx-auto mb-2" />
                    <p className="text-sm font-medium">Scanning invoice...</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Processing with AI OCR Engine</span>
                <span className="font-mono font-medium">{progress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 to-blue-500 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {progress < 30 ? "Loading OCR engine..." :
                  progress < 80 ? "Recognizing text from image..." :
                    "Parsing invoice data..."}
              </p>
            </div>
          </div>
        )}

        {/* ─── Step 3: Review ─────────────────────────────────── */}
        {step === "review" && parsedInvoice && (
          <div className="p-4 space-y-4">
            {/* Invoice Meta */}
            <div className="grid grid-cols-3 gap-3">
              {parsedInvoice.supplierName && (
                <Card className="bg-muted/50">
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Supplier</p>
                    <p className="text-sm font-semibold truncate">{parsedInvoice.supplierName}</p>
                  </CardContent>
                </Card>
              )}
              {parsedInvoice.invoiceNumber && (
                <Card className="bg-muted/50">
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Invoice #</p>
                    <p className="text-sm font-semibold truncate">{parsedInvoice.invoiceNumber}</p>
                  </CardContent>
                </Card>
              )}
              {parsedInvoice.date && (
                <Card className="bg-muted/50">
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Date</p>
                    <p className="text-sm font-semibold truncate">{parsedInvoice.date}</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Confidence Score */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">AI Confidence</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-24 bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      parsedInvoice.confidence >= 70 ? "bg-emerald-500" :
                      parsedInvoice.confidence >= 40 ? "bg-amber-500" : "bg-red-500"
                    }`}
                    style={{ width: `${parsedInvoice.confidence}%` }}
                  />
                </div>
                <span className="text-sm font-mono font-bold">{parsedInvoice.confidence}%</span>
              </div>
            </div>

            {/* Detected Items Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <FileText className="h-4 w-4" />
                  Detected Items ({items.length})
                </h3>
                <span className="text-xs text-muted-foreground">
                  {items.filter(i => i.selected).length} selected for import
                </span>
              </div>

              {items.length === 0 ? (
                <div className="h-24 flex items-center justify-center text-muted-foreground text-sm border rounded-lg">
                  No items detected. Try uploading a clearer image.
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right w-20">Qty</TableHead>
                        <TableHead className="text-right w-24">Rate</TableHead>
                        <TableHead className="text-right w-28">Total</TableHead>
                        <TableHead className="w-16">Conf.</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow
                          key={item.id}
                          className={!item.selected ? "opacity-40" : ""}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={() => toggleItem(item.id)}
                              className="rounded border-muted-foreground/30"
                            />
                          </TableCell>
                          <TableCell>
                            {editingId === item.id ? (
                              <Input
                                value={item.name}
                                onChange={(e) => updateItem(item.id, "name", e.target.value)}
                                onBlur={() => setEditingId(null)}
                                onKeyDown={(e) => e.key === "Enter" && setEditingId(null)}
                                className="h-7 text-xs"
                                autoFocus
                              />
                            ) : (
                              <span
                                className="text-sm font-medium cursor-pointer hover:text-purple-600"
                                onClick={() => setEditingId(item.id)}
                                title="Click to edit"
                              >
                                {item.name}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateItem(item.id, "quantity", parseInt(e.target.value) || 0)}
                              className="h-7 text-xs text-right w-16 ml-auto"
                              min={0}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)}
                              className="h-7 text-xs text-right w-20 ml-auto"
                              min={0}
                              step={0.01}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            {item.total.toLocaleString()}
                          </TableCell>
                          <TableCell>{confidenceBadge(item.confidence)}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => removeItem(item.id)}
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Totals */}
            {items.filter(i => i.selected).length > 0 && (
              <div className="flex justify-end">
                <div className="bg-muted/50 rounded-lg p-3 min-w-48">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Selected Items Total:</span>
                    <span className="font-bold font-mono">
                      {items.filter(i => i.selected).reduce((s, i) => s + i.total, 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Image Preview Thumbnail */}
            {imagePreview && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <ZoomIn className="h-3 w-3" /> View scanned image
                </summary>
                <img src={imagePreview} alt="Scanned invoice" className="mt-2 rounded-lg border max-h-48 object-contain" />
              </details>
            )}
          </div>
        )}
      </div>

      {/* ─── Footer ───────────────────────────────────────────── */}
      <DialogFooter>
        {step === "upload" && (
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
        )}
        {step === "processing" && (
          <Button variant="outline" onClick={() => { reset(); }}>Cancel</Button>
        )}
        {step === "review" && (
          <div className="flex w-full gap-2">
            <Button variant="outline" onClick={reset} className="flex-1">
              <Camera className="h-4 w-4 mr-1" /> Scan Again
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={items.filter(i => i.selected).length === 0}
              className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Check className="h-4 w-4 mr-1" />
              Import {items.filter(i => i.selected).length} Item(s)
            </Button>
          </div>
        )}
      </DialogFooter>
    </Dialog>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Loader2, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// TypeScript declarations for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// ─── Command Intents ──────────────────────────────────────────────────
const NAVIGATION_INTENTS = [
  { keywords: ["dashboard", "home", "main"], path: "/dashboard", name: "Dashboard" },
  { keywords: ["inventory", "stock", "components", "items"], path: "/dashboard/inventory", name: "Inventory" },
  { keywords: ["new sale", "create sale", "sell"], path: "/dashboard/sales/new", name: "New Sale" },
  { keywords: ["sales", "invoices", "orders"], path: "/dashboard/sales", name: "Sales" },
  { keywords: ["new purchase", "buy", "create purchase"], path: "/dashboard/purchases/new", name: "New Purchase" },
  { keywords: ["purchases", "purchase orders"], path: "/dashboard/purchases", name: "Purchases" },
  { keywords: ["customers", "clients", "buyers"], path: "/dashboard/customers", name: "Customers" },
  { keywords: ["suppliers", "vendors"], path: "/dashboard/suppliers", name: "Suppliers" },
  { keywords: ["daybook", "cash book", "daily book"], path: "/dashboard/daybook", name: "Daybook" },
  { keywords: ["finance", "accounts", "money"], path: "/dashboard/finance", name: "Finance" },
  { keywords: ["projects", "jobs", "tasks"], path: "/dashboard/projects", name: "Projects" },
  { keywords: ["reports", "analytics", "stats"], path: "/dashboard/reports", name: "Reports" },
  { keywords: ["backup", "sync", "settings"], path: "/dashboard/backup", name: "Backup" },
];

export default function VoiceAssistant() {
  const router = useRouter();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  
  const recognitionRef = useRef<any>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true; // Show text as user speaks
        recognitionRef.current.lang = "en-US"; // Can be changed or made dynamic (e.g. ur-PK for Urdu)

        recognitionRef.current.onstart = () => {
          setIsListening(true);
          setError(null);
          setTranscript("Listening...");
        };

        recognitionRef.current.onresult = (event: any) => {
          let currentTranscript = "";
          let isFinal = false;
          
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              isFinal = true;
              currentTranscript += event.results[i][0].transcript;
            } else {
              currentTranscript += event.results[i][0].transcript;
            }
          }
          
          setTranscript(currentTranscript);
          
          if (isFinal) {
            processCommand(currentTranscript.toLowerCase());
            setTimeout(() => setTranscript(""), 4000);
          }
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error("Speech recognition error", event.error);
          setIsListening(false);
          
          if (event.error === "not-allowed") {
            setError("Microphone access denied. Please enable it in your browser settings.");
            toast.error("Microphone access denied");
          } else if (event.error === "no-speech") {
            setError("No speech detected.");
          } else {
            setError(`Error: ${event.error}`);
          }
          
          setTimeout(() => setTranscript(""), 3000);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
          // Don't clear transcript immediately if we successfully parsed something
          if (transcript === "Listening...") {
            setTranscript("");
          }
        };
      } else {
        setError("Speech recognition is not supported in this browser. Try Google Chrome.");
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const processCommand = (text: string) => {
    // 1. Check for Navigation Intents
    if (text.includes("go to") || text.includes("open") || text.includes("show")) {
      for (const intent of NAVIGATION_INTENTS) {
        if (intent.keywords.some(kw => text.includes(kw))) {
          toast.success(`Navigating to ${intent.name}`);
          router.push(intent.path);
          return;
        }
      }
    }

    // 2. Direct Navigation (without "go to")
    for (const intent of NAVIGATION_INTENTS) {
      if (intent.keywords.some(kw => text === kw || text === `go ${kw}`)) {
        toast.success(`Navigating to ${intent.name}`);
        router.push(intent.path);
        return;
      }
    }

    // 3. Action Intents
    if (text.includes("add") || text.includes("new") || text.includes("create")) {
      if (text.includes("customer")) { router.push("/dashboard/customers"); toast.info("Opening Customers"); return; }
      if (text.includes("supplier") || text.includes("vendor")) { router.push("/dashboard/suppliers"); toast.info("Opening Suppliers"); return; }
      if (text.includes("item") || text.includes("component") || text.includes("stock")) { router.push("/dashboard/inventory"); toast.info("Opening Inventory"); return; }
    }

    // 4. Unrecognized
    toast.error("Command not recognized: " + text);
  };

  const toggleListen = () => {
    if (error && error.includes("not supported")) {
      toast.error(error);
      return;
    }

    if (isListening) {
      recognitionRef.current?.abort(); // Forcefully abort instead of stop to immediately end it
      setIsListening(false);
      if (transcript === "Listening...") setTranscript("");
    } else {
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.error(e); // Handle already started error
      }
    }
  };

  const showHelp = () => {
    setShowTooltip(true);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => setShowTooltip(false), 5000);
  };

  if (error && error.includes("not supported")) {
    return null; // Hide completely if browser doesn't support it
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      
      {/* Transcript Bubble */}
      {(transcript || error || showTooltip) && (
        <div className={cn(
          "bg-popover text-popover-foreground border shadow-lg rounded-2xl p-3 max-w-[280px] animate-in fade-in slide-in-from-bottom-4 duration-200",
          error ? "border-red-500/50" : isListening ? "border-primary/50" : ""
        )}>
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : showTooltip && !transcript ? (
            <div className="text-sm space-y-1">
              <p className="font-semibold flex items-center gap-1"><Info className="h-4 w-4 text-blue-500" /> Voice Commands</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Try saying: "Go to Inventory", "Open new sale", "Show reports", or "Go to Customers".
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {isListening && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <p className="text-sm font-medium">
                {transcript === "Listening..." ? <span className="text-muted-foreground italic">Listening...</span> : `"${transcript}"`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Floating Action Button */}
      <div className="flex items-center gap-2">
        {!isListening && !transcript && (
          <Button 
            variant="outline" 
            size="icon" 
            className="h-10 w-10 rounded-full shadow-sm bg-background/80 backdrop-blur"
            onClick={showHelp}
          >
            <Info className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
        
        <Button
          size="icon"
          className={cn(
            "h-14 w-14 rounded-full shadow-xl transition-all duration-300",
            isListening 
              ? "bg-red-500 hover:bg-red-600 animate-pulse shadow-red-500/30" 
              : "bg-blue-600 hover:bg-blue-700 hover:scale-105"
          )}
          onClick={toggleListen}
        >
          {isListening ? (
            <MicOff className="h-6 w-6 text-white" />
          ) : (
            <Mic className="h-6 w-6 text-white" />
          )}
        </Button>
      </div>
    </div>
  );
}

// src/app/page.tsx - Landing Page
import Link from "next/link";
import { Cpu, ArrowRight, Package, ShoppingCart, ChartBar, Users, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/30">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm shadow-primary/20">
            <Package className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight">PM-ERP</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost">Sign In</Button>
          </Link>
          <Link href="/register">
            <Button>Get Started</Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary mb-6 shadow-sm">
          <Package className="h-3 w-3 text-primary" />
          Made for Paper Mills & Packaging in Pakistan
        </div>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight max-w-4xl mx-auto">
          Complete Business OS for{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-chart-2">
            Paper Mills
          </span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Manage paper stock, dimensions, rims, bulk orders, product sales, finances, partners, and customers — 
          all in one professional ERP built for the paper and packaging industry.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link href="/register">
            <Button size="lg" className="gap-2 shadow-lg shadow-primary/20">
              Start Free <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" size="lg" className="bg-background">
              Sign In
            </Button>
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
          Everything Your Paper Mill Needs
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: Package, title: "Inventory Management", desc: "Track paper stock, auto-calculate Kg from GSM/Dimensions, manage rims and loose sheets with low-stock alerts." },
            { icon: ShoppingCart, title: "Product Sales", desc: "Customer sales, invoice generation, profit tracking per sale, auto price calculation based on Rate/Kg." },
            { icon: ChartBar, title: "Project & Job Management", desc: "Full job lifecycle — from planning to completion. Track costs, stock used, team members, and profit per job." },
            { icon: Users, title: "Partner & Finance", desc: "Partner investment tracking with profit-sharing. Full finance module: income, expenses, P&L, cash flow analysis." },
            { icon: Shield, title: "Role-Based Access", desc: "Admin, Partner, Employee, Inventory Manager, Accountant — each role sees exactly what they need." },
            { icon: Zap, title: "Auto Calculations", desc: "Profit/loss auto-calculated. When stock is used or sold, inventory and finances update instantly based on precise formulas." },
          ].map((feature) => (
            <div key={feature.title} className="rounded-xl border bg-card p-6 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-16 text-center">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-chart-1 p-10 md:p-16 text-primary-foreground shadow-xl shadow-primary/20">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready to Run Your Business Like a Pro?
          </h2>
          <p className="text-primary-foreground/90 mb-8 max-w-lg mx-auto text-lg">
            Built for Pakistani paper mills. Manage bulk paper stock, calculations, invoices, and finances — all in one place.
          </p>
          <Link href="/register">
            <Button size="lg" variant="secondary" className="gap-2 text-primary font-semibold">
              Get Started Now <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-6 text-center text-sm text-muted-foreground bg-background">
        <p>&copy; {new Date().getFullYear()} Paper Mill ERP. Built in Pakistan 🇵🇰</p>
      </footer>
    </div>
  );
}

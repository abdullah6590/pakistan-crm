"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PROJECT_STATUSES } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

interface UserOption { id: string; name: string; email: string; role: string; }
interface ComponentOption { id: string; name: string; sku: string; unitCost: number; unitPrice: number; quantity: number; category?: { name: string }; }

export function NewProjectClient({ users, components }: { users: UserOption[]; components: ComponentOption[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", clientName: "", clientPhone: "", clientEmail: "",
    startDate: new Date().toISOString().split("T")[0], deadline: "",
    status: "PLANNING", laborCost: "0", otherCosts: "0", clientPayment: "0", notes: "",
  });
  const [teamMembers, setTeamMembers] = useState<{ userId: string; role: string; hours: string; rate: string }[]>([{ userId: "", role: "Developer", hours: "0", rate: "0" }]);
  const [projectComponents, setProjectComponents] = useState<{ componentId: string; quantity: string }[]>([]);

  const updateField = (field: string, value: string) => setForm({ ...form, [field]: value });

  const addTeamMember = () => setTeamMembers([...teamMembers, { userId: "", role: "Developer", hours: "0", rate: "0" }]);
  const removeTeamMember = (i: number) => setTeamMembers(teamMembers.filter((_, idx) => idx !== i));
  const updateTeam = (i: number, field: string, value: string) => {
    const updated = [...teamMembers];
    updated[i] = { ...updated[i], [field]: value };
    setTeamMembers(updated);
  };

  const addComponent = (componentId: string) => {
    if (projectComponents.some(c => c.componentId === componentId)) {
      toast.error("Component already added"); return;
    }
    setProjectComponents([...projectComponents, { componentId, quantity: "1" }]);
  };
  const removeComponent = (i: number) => setProjectComponents(projectComponents.filter((_, idx) => idx !== i));
  const updateCompQty = (i: number, qty: string) => {
    const updated = [...projectComponents];
    updated[i] = { ...updated[i], quantity: qty };
    setProjectComponents(updated);
  };

  // Calculated costs
  const compTotalCost = projectComponents.reduce((sum, c) => {
    const comp = components.find(co => co.id === c.componentId);
    return sum + (comp ? (comp.unitCost || 0) * (parseInt(c.quantity) || 0) : 0);
  }, 0);
  const laborTotal = teamMembers.reduce((sum, t) => sum + (parseFloat(t.hours) || 0) * (parseFloat(t.rate) || 0), 0);
  const totalCost = compTotalCost + laborTotal + (parseFloat(form.otherCosts) || 0);
  const estimatedProfit = (parseFloat(form.clientPayment) || 0) - totalCost;

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error("Project name is required"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          clientName: form.clientName || undefined,
          clientPhone: form.clientPhone || undefined,
          clientEmail: form.clientEmail || undefined,
          startDate: new Date(form.startDate),
          deadline: form.deadline ? new Date(form.deadline) : undefined,
          status: form.status,
          laborCost: laborTotal,
          otherCosts: parseFloat(form.otherCosts) || 0,
          clientPayment: parseFloat(form.clientPayment) || 0,
          notes: form.notes || undefined,
          teamMembers: teamMembers.filter(t => t.userId).map(t => ({
            userId: t.userId, role: t.role,
            hours: parseFloat(t.hours) || 0, rate: parseFloat(t.rate) || 0,
          })),
          components: projectComponents.map(c => ({
            componentId: c.componentId,
            quantity: parseInt(c.quantity) || 1,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");
      toast.success("Project created successfully!");
      router.push(`/dashboard/projects/${data.project.id}`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
          <p className="text-sm text-muted-foreground">Create a new electronics/IoT project</p>
        </div>
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader><CardTitle>Project Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Project Name *</Label>
              <Input value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g. IoT Weather Station" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Project details..." rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={form.startDate} onChange={(e) => updateField("startDate", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Deadline</Label>
              <Input type="date" value={form.deadline} onChange={(e) => updateField("deadline", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onChange={(v) => updateField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client Info */}
      <Card>
        <CardHeader><CardTitle>Client Information</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Client Name</Label>
            <Input value={form.clientName} onChange={(e) => updateField("clientName", e.target.value)} placeholder="Client name" />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={form.clientPhone} onChange={(e) => updateField("clientPhone", e.target.value)} placeholder="+92 300 1234567" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={form.clientEmail} onChange={(e) => updateField("clientEmail", e.target.value)} placeholder="client@example.com" />
          </div>
        </CardContent>
      </Card>

      {/* Financials */}
      <Card>
        <CardHeader><CardTitle>Financial Overview</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Client Payment (Rs.)</Label>
              <Input type="number" value={form.clientPayment} onChange={(e) => updateField("clientPayment", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Other Costs (Rs.)</Label>
              <Input type="number" value={form.otherCosts} onChange={(e) => updateField("otherCosts", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Any notes..." rows={2} />
            </div>
          </div>
          {/* Summary */}
          <div className="rounded-lg bg-muted/50 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><span className="text-muted-foreground">Component Cost:</span> <strong>{formatCurrency(compTotalCost)}</strong></div>
            <div><span className="text-muted-foreground">Labor Cost:</span> <strong>{formatCurrency(laborTotal)}</strong></div>
            <div><span className="text-muted-foreground">Total Cost:</span> <strong>{formatCurrency(totalCost)}</strong></div>
            <div><span className="text-muted-foreground">Est. Profit:</span> <strong className={estimatedProfit >= 0 ? "text-emerald-600" : "text-red-600"}>{formatCurrency(estimatedProfit)}</strong></div>
          </div>
        </CardContent>
      </Card>

      {/* Team Members */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Team Members</CardTitle>
          <Button variant="outline" size="sm" onClick={addTeamMember}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {teamMembers.map((tm, i) => (
            <div key={i} className="flex items-end gap-2 p-3 rounded-lg border bg-muted/30">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">User</Label>
                <Select value={tm.userId} onChange={(v) => updateTeam(i, "userId", v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28 space-y-1">
                <Label className="text-xs">Role</Label>
                <Input className="h-9 text-xs" value={tm.role} onChange={(e) => updateTeam(i, "role", e.target.value)} placeholder="Developer" />
              </div>
              <div className="w-20 space-y-1">
                <Label className="text-xs">Hours</Label>
                <Input className="h-9 text-xs" type="number" value={tm.hours} onChange={(e) => updateTeam(i, "hours", e.target.value)} />
              </div>
              <div className="w-20 space-y-1">
                <Label className="text-xs">Rate/hr</Label>
                <Input className="h-9 text-xs" type="number" value={tm.rate} onChange={(e) => updateTeam(i, "rate", e.target.value)} />
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-red-500" onClick={() => removeTeamMember(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {teamMembers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No team members added yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Components */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Components Used</CardTitle>
          <div className="flex gap-2">
            <Select value="" onChange={(v) => v && addComponent(v)}>
              <SelectTrigger className="h-9 text-xs w-48"><SelectValue placeholder="Add Product..." /></SelectTrigger>
              <SelectContent>
                {components.filter(c => !projectComponents.some(pc => pc.componentId === c.id)).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.sku})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {projectComponents.map((pc, i) => {
            const comp = components.find(c => c.id === pc.componentId);
            return (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg border">
                <div className="flex-1">
                  <p className="text-sm font-medium">{comp?.name || pc.componentId}</p>
                  <p className="text-xs text-muted-foreground">{comp?.sku} · Stock: {comp?.quantity} · Cost: {formatCurrency(comp?.unitCost || 0)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Qty</Label>
                  <Input className="w-16 h-8 text-xs" type="number" min="1" value={pc.quantity} onChange={(e) => updateCompQty(i, e.target.value)} />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeComponent(i)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
          {projectComponents.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No components assigned yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex items-center gap-3 justify-end">
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={loading} size="lg">
          <Save className="h-4 w-4 mr-2" />
          {loading ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </div>
  );
}
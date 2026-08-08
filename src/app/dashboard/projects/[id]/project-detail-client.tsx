"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Edit, Trash2, Plus, X, Save, Clock, BadgeCheck,
  AlertTriangle, Ban, Calendar, DollarSign, Users, Cpu,
  User, Mail, Phone, FileText, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatCurrency, formatDate, daysUntil } from "@/lib/utils";
import { PROJECT_STATUSES } from "@/lib/constants";
import { toast } from "sonner";

interface ProjectData {
  id: string; projectId: string; name: string; description: string | null;
  clientName: string | null; clientPhone: string | null; clientEmail: string | null;
  startDate: string; deadline: string | null; status: string;
  laborCost: number; otherCosts: number; clientPayment: number; totalCost: number;
  profit: number; paymentStatus: string; notes: string | null; color: string;
  userId: string; createdAt: string;
  user?: { name: string };
  teamMembers: { id: string; userId: string; role: string; hours: number; rate: number; cost: number; user?: { name: string; email: string } }[];
  components: { id: string; componentId: string; quantity: number; unitCost: number; totalCost: number; component?: { id: string; name: string; sku: string; unitCost: number; quantity: number; category?: { name: string } } }[];
  invoices?: any[];
}

interface UserOption { id: string; name: string; email: string; role: string; }
interface ComponentOption { id: string; name: string; sku: string; unitCost: number; unitPrice: number; quantity: number; category?: { name: string }; }

const statusConfig: Record<string, { icon: React.ElementType; variant: "default"|"secondary"|"success"|"warning"|"destructive"; label: string }> = {
  PLANNING: { icon: Clock, variant: "secondary", label: "Planning" },
  IN_PROGRESS: { icon: Wrench, variant: "default", label: "In Progress" },
  COMPLETED: { icon: BadgeCheck, variant: "success", label: "Completed" },
  ON_HOLD: { icon: AlertTriangle, variant: "warning", label: "On Hold" },
  CANCELLED: { icon: Ban, variant: "destructive", label: "Cancelled" },
};

export function ProjectDetailClient({ project: initialProject, users, components, currentUserRole }: {
  project: ProjectData; users: UserOption[]; components: ComponentOption[]; currentUserRole: string;
}) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addingComponent, setAddingComponent] = useState(false);

  const [form, setForm] = useState({
    name: project.name, description: project.description || "", clientName: project.clientName || "",
    clientPhone: project.clientPhone || "", clientEmail: project.clientEmail || "",
    status: project.status, laborCost: String(project.laborCost), otherCosts: String(project.otherCosts),
    clientPayment: String(project.clientPayment), paymentStatus: project.paymentStatus,
    notes: project.notes || "",
  });
  const [newComp, setNewComp] = useState({ componentId: "", quantity: "1" });
  const [newMember, setNewMember] = useState({ userId: "", role: "Developer", hours: "0", rate: "0" });
  const [showAddMember, setShowAddMember] = useState(false);

  const status = statusConfig[project.status] || statusConfig.PLANNING;
  const isOverdue = project.deadline && new Date(project.deadline) < new Date() && project.status !== "COMPLETED";
  const profitColor = project.profit >= 0 ? "text-emerald-600" : "text-red-600";

  const handleUpdate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          laborCost: parseFloat(form.laborCost) || 0,
          otherCosts: parseFloat(form.otherCosts) || 0,
          clientPayment: parseFloat(form.clientPayment) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setProject(data.project);
      setEditing(false);
      toast.success("Project updated");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Project deleted");
      router.push("/dashboard/projects");
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleAddComponent = async () => {
    if (!newComp.componentId) { toast.error("Select a product"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addComponent: { componentId: newComp.componentId, quantity: parseInt(newComp.quantity) || 1 },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add component");
      setProject(data.project);
      setNewComp({ componentId: "", quantity: "1" });
      setAddingComponent(false);
      toast.success("Product added");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleRemoveComponent = async (componentId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeComponent: componentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setProject(data.project);
      toast.success("Component removed");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleAddMember = async () => {
    if (!newMember.userId) { toast.error("Select a user"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addTeamMember: { ...newMember, hours: parseFloat(newMember.hours) || 0, rate: parseFloat(newMember.rate) || 0 },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setProject(data.project);
      setNewMember({ userId: "", role: "Developer", hours: "0", rate: "0" });
      setShowAddMember(false);
      toast.success("Member added");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleRemoveMember = async (userId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeTeamMember: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setProject(data.project);
      toast.success("Member removed");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/projects")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground font-mono mt-0.5">{project.projectId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditing(!editing)}>
            <Edit className="h-4 w-4 mr-1" /> {editing ? "Cancel" : "Edit"}
          </Button>
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm">{project.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><DollarSign className="h-5 w-5 text-primary" /></div>
            <div><p className="text-xs text-muted-foreground">Client Payment</p><p className="text-lg font-bold">{formatCurrency(project.clientPayment)}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10"><DollarSign className="h-5 w-5 text-red-500" /></div>
            <div><p className="text-xs text-muted-foreground">Total Cost</p><p className="text-lg font-bold">{formatCurrency(project.totalCost)}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${project.profit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
              <DollarSign className={`h-5 w-5 ${project.profit >= 0 ? "text-emerald-500" : "text-red-500"}`} />
            </div>
            <div><p className="text-xs text-muted-foreground">Profit</p><p className={`text-lg font-bold ${profitColor}`}>{formatCurrency(project.profit)}</p></div>
          </CardContent>
        </Card>
        {project.deadline && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isOverdue ? "bg-red-500/10" : "bg-blue-500/10"}`}>
                <Calendar className={`h-5 w-5 ${isOverdue ? "text-red-500" : "text-blue-500"}`} />
              </div>
              <div><p className="text-xs text-muted-foreground">Deadline</p><p className="text-sm font-bold">{formatDate(project.deadline)}</p><p className="text-xs text-muted-foreground">{daysUntil(project.deadline)}d remaining</p></div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Client Info */}
      {project.clientName && (
        <Card>
          <CardHeader><CardTitle className="text-base">Client Information</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3 text-sm">
            <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> {project.clientName}</div>
            {project.clientPhone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {project.clientPhone}</div>}
            {project.clientEmail && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {project.clientEmail}</div>}
          </CardContent>
        </Card>
      )}

      {/* Team Members */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Team Members</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowAddMember(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </CardHeader>
        <CardContent>
          {project.teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No team members assigned.</p>
          ) : (
            <div className="space-y-2">
              {project.teamMembers.map((tm) => (
                <div key={tm.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {(tm.user?.name || "?").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tm.user?.name || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{tm.role} · {tm.hours}h × Rs.{tm.rate}/hr = {formatCurrency(tm.cost)}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-red-500 h-8 w-8" onClick={() => handleRemoveMember(tm.userId)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Components */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Components Used</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setAddingComponent(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </CardHeader>
        <CardContent>
          {project.components.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No components assigned.</p>
          ) : (
            <div className="space-y-2">
              {project.components.map((pc) => (
                <div key={pc.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">{pc.component?.name || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">
                      {pc.component?.sku} · Qty: {pc.quantity} · Unit Cost: {formatCurrency(pc.unitCost)} · Total: {formatCurrency(pc.totalCost)}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-red-500 h-8 w-8" onClick={() => handleRemoveComponent(pc.componentId)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editing} onClose={() => setEditing(false)}>
        <DialogHeader><DialogTitle>Edit Project</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-4">
          <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div className="space-y-1"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Status</Label>
              <Select value={form.status} onChange={v => setForm({...form, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PROJECT_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Payment Status</Label>
              <Select value={form.paymentStatus} onChange={v => setForm({...form, paymentStatus: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Client Payment</Label><Input type="number" value={form.clientPayment} onChange={e => setForm({...form, clientPayment: e.target.value})} /></div>
            <div className="space-y-1"><Label>Labor Cost</Label><Input type="number" value={form.laborCost} onChange={e => setForm({...form, laborCost: e.target.value})} /></div>
            <div className="space-y-1"><Label>Other Costs</Label><Input type="number" value={form.otherCosts} onChange={e => setForm({...form, otherCosts: e.target.value})} /></div>
          </div>
          <div className="space-y-1"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          <Button onClick={handleUpdate} disabled={loading}>{loading ? "Saving..." : "Save Changes"}</Button>
        </DialogFooter>
      </Dialog>

      {/* Add Product Dialog */}
      <Dialog open={addingComponent} onClose={() => setAddingComponent(false)}>
        <DialogHeader><DialogTitle>Add Product</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-4">
          <div className="space-y-1"><Label>Product</Label>
            <Select value={newComp.componentId} onChange={v => setNewComp({...newComp, componentId: v})}>
              <SelectTrigger><SelectValue placeholder="Select Product" /></SelectTrigger>
              <SelectContent>
                {components.filter(c => !project.components.some(pc => pc.componentId === c.id)).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.sku}) - Stock: {c.quantity}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Quantity</Label><Input type="number" min="1" value={newComp.quantity} onChange={e => setNewComp({...newComp, quantity: e.target.value})} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddingComponent(false)}>Cancel</Button>
          <Button onClick={handleAddComponent} disabled={loading}>Add</Button>
        </DialogFooter>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={showAddMember} onClose={() => setShowAddMember(false)}>
        <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-4">
          <div className="space-y-1"><Label>User</Label>
            <Select value={newMember.userId} onChange={v => setNewMember({...newMember, userId: v})}>
              <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
              <SelectContent>
                {users.filter(u => !project.teamMembers.some(tm => tm.userId === u.id)).map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Role</Label><Input value={newMember.role} onChange={e => setNewMember({...newMember, role: e.target.value})} /></div>
            <div className="space-y-1"><Label>Hours</Label><Input type="number" value={newMember.hours} onChange={e => setNewMember({...newMember, hours: e.target.value})} /></div>
          </div>
          <div className="space-y-1"><Label>Rate/hr (Rs.)</Label><Input type="number" value={newMember.rate} onChange={e => setNewMember({...newMember, rate: e.target.value})} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAddMember(false)}>Cancel</Button>
          <Button onClick={handleAddMember} disabled={loading}>Add</Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleting} onClose={() => setDeleting(false)} onConfirm={handleDelete}
        title="Delete Project" description={`Are you sure you want to delete "${project.name}"? This will also remove all associated team members and component allocations.`}
        loading={loading}
      />
    </div>
  );
}
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserCog, Plus, Trash2, Shield, Mail, Phone, MoreHorizontal,
  UserCheck, UserX, Clock, CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatDate, timeAgo } from "@/lib/utils";
import { USER_ROLES } from "@/lib/constants";
import { toast } from "sonner";

interface UserData {
  id: string; name: string; email: string; role: string;
  phone: string | null; image: string | null; isActive: boolean; createdAt: string;
}

const roleBadge: Record<string, { variant: "default" | "secondary" | "success" | "warning" | "destructive"; label: string }> = {
  ADMIN: { variant: "destructive", label: "Admin" },
  PARTNER: { variant: "default", label: "Partner" },
  EMPLOYEE: { variant: "secondary", label: "Employee" },
  INVENTORY_MANAGER: { variant: "success", label: "Inventory Mgr" },
  ACCOUNTANT: { variant: "warning", label: "Accountant" },
};

export function UsersClient({ users: initialUsers }: { users: UserData[] }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserData | null>(null);
  const [deleting, setDeleting] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "EMPLOYEE", phone: "" });

  const filtered = users.filter((u) => {
    if (search && !u.name.toLowerCase().includes(search.toLowerCase()) &&
        !u.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    return true;
  });

  const resetForm = () => setForm({ name: "", email: "", password: "", role: "EMPLOYEE", phone: "" });

  const openCreate = () => { resetForm(); setShowCreate(true); };
  const openEdit = (u: UserData) => {
    setForm({ name: u.name, email: u.email, password: "", role: u.role, phone: u.phone || "" });
    setEditing(u);
  };

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password) {
      toast.error("Please fill all required fields"); return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      setUsers([data.user, ...users]);
      setShowCreate(false);
      toast.success("User created successfully");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setLoading(true);
    try {
      const body: any = { name: form.name, role: form.role, phone: form.phone };
      if (form.password) body.password = form.password;
      const res = await fetch(`/api/users/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update user");
      setUsers(users.map((u) => u.id === editing.id ? { ...u, ...body } : u));
      setEditing(null);
      toast.success("User updated");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/users/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user");
      setUsers(users.filter((u) => u.id !== deleting.id));
      setDeleting(null);
      toast.success("User deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  const columns: Column<UserData>[] = [
    {
      header: "User",
      accessor: (u) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {u.name.split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2)}
          </div>
          <div>
            <p className="text-sm font-medium">{u.name}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Mail className="h-3 w-3" /> {u.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      header: "Role",
      accessor: (u) => {
        const rb = roleBadge[u.role] || { variant: "secondary" as const, label: u.role };
        return <Badge variant={rb.variant} size="sm">{rb.label}</Badge>;
      },
    },
    {
      header: "Phone",
      accessor: (u) => u.phone ? (
        <span className="text-sm text-muted-foreground flex items-center gap-1">
          <Phone className="h-3 w-3" /> {u.phone}
        </span>
      ) : <span className="text-sm text-muted-foreground">—</span>,
    },
    {
      header: "Status",
      accessor: (u) => u.isActive ? (
        <Badge variant="success" size="sm"><CheckCircle className="h-3 w-3 mr-1" />Active</Badge>
      ) : (
        <Badge variant="secondary" size="sm"><UserX className="h-3 w-3 mr-1" />Inactive</Badge>
      ),
    },
    {
      header: "Joined",
      accessor: (u) => <span className="text-sm text-muted-foreground">{timeAgo(u.createdAt)}</span>,
    },
    {
      header: "Actions",
      accessor: (u) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>Edit</Button>
          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600"
            onClick={() => setDeleting(u)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const formContent = (
    <div className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label>Full Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ahmed Khan" />
      </div>
      <div className="space-y-2">
        <Label>Email *</Label>
        <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ahmed@example.com" disabled={!!editing} />
      </div>
      <div className="space-y-2">
        <Label>Password {editing ? "(leave blank to keep)" : "*"}</Label>
        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Minimum 6 characters" />
      </div>
      <div className="space-y-2">
        <Label>Phone</Label>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+92 300 1234567" />
      </div>
      <div className="space-y-2">
        <Label>Role</Label>
        <Select value={form.role} onChange={(v) => setForm({ ...form, role: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {USER_ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const totalAdmins = users.filter(u => u.role === "ADMIN").length;
  const totalActive = users.filter(u => u.isActive).length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCog}
        title="User Management"
        description={`${users.length} users · ${totalActive} active · ${totalAdmins} admins`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Add User
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search users..." className="flex-1" />
        <Select value={roleFilter} onChange={(v) => setRoleFilter(v)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Roles</SelectItem>
            {USER_ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filtered} keyField="id" emptyMessage="No users found." />

      {/* Create/Edit Dialog */}
      <Dialog open={showCreate || !!editing} onClose={() => { setShowCreate(false); setEditing(null); }}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit User" : "Create New User"}</DialogTitle>
        </DialogHeader>
        {formContent}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowCreate(false); setEditing(null); }}>Cancel</Button>
          <Button onClick={editing ? handleUpdate : handleCreate} disabled={loading}>
            {loading ? "Saving..." : editing ? "Update User" : "Create User"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete User"
        description={`Are you sure you want to delete ${deleting?.name}? This action cannot be undone.`}
        loading={loading}
      />
    </div>
  );
}
"use client";

import { useState } from "react";
import { Settings, User, Shield, Palette, Key, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { toast } from "sonner";

interface Props { user: { id: string; name: string; email: string; role: string }; }

export default function SettingsClient({ user }: Props) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleUpdateProfile = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Profile updated successfully");
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingProfile(false); }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) { toast.error("Current password is required"); return; }
    if (!newPassword) { toast.error("New password is required"); return; }
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    setSavingPassword(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingPassword(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Settings"
        description="Manage your account settings and preferences"
        icon={Settings}
      />

      {/* Profile Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><User className="h-5 w-5" /> Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email" type="email" />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Input value={user.role} disabled className="bg-muted" />
          </div>
          <Button onClick={handleUpdateProfile} disabled={savingProfile}>
            {savingProfile ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Key className="h-5 w-5" /> Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Current Password</Label>
            <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Enter current password" />
          </div>
          <div className="space-y-1">
            <Label>New Password</Label>
            <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <div className="space-y-1">
            <Label>Confirm New Password</Label>
            <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" />
          </div>
          <Button onClick={handleChangePassword} disabled={savingPassword} variant="outline">
            {savingPassword ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Change Password
          </Button>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Palette className="h-5 w-5" /> About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><strong>Electronics Startup ERP</strong> — IoT & Electronics Solutions</p>
          <p>Version: 1.0.0</p>
          <p>Built with Next.js 16, Prisma, and Tailwind CSS</p>
          <p className="pt-2">Pakistan • PKR Currency • JazzCash / EasyPaisa / NayaPay / SadaPay</p>
        </CardContent>
      </Card>
    </div>
  );
}
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { User, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const AccountSettings = () => {
  const { user } = useAuth();

  // Perfil
  const [fullName, setFullName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // E-mail
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  // Senha
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const n = data?.full_name || "";
        setFullName(n);
        setInitialName(n);
      });
  }, [user]);

  const initial = (fullName || user?.email || "?").charAt(0).toUpperCase();

  const saveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() || null })
        .eq("user_id", user.id);
      if (error) throw error;
      setInitialName(fullName.trim());
      toast.success("Perfil atualizado!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar o perfil");
    } finally {
      setSavingProfile(false);
    }
  };

  const changeEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || email === user?.email) {
      toast.error("Informe um e-mail diferente do atual");
      return;
    }
    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      toast.success(
        "Enviamos um link de confirmação para o novo e-mail. A troca só vale após confirmar.",
      );
      setNewEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao solicitar troca de e-mail");
    } finally {
      setSavingEmail(false);
    }
  };

  const changePassword = async () => {
    if (!user?.email) return;
    if (newPw.length < 8) {
      toast.error("A nova senha precisa ter ao menos 8 caracteres");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("A confirmação não confere com a nova senha");
      return;
    }
    setSavingPw(true);
    try {
      // Reautentica para confirmar a senha atual antes de trocar
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPw,
      });
      if (reauthError) {
        toast.error("Senha atual incorreta");
        setSavingPw(false);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      toast.success("Senha alterada com sucesso!");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao alterar a senha");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Minha Conta</h1>
        <p className="text-muted-foreground">Seu perfil, e-mail e senha</p>
      </div>

      {/* Perfil */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <User className="w-5 h-5 text-primary" /> Perfil
        </h3>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold">
              {initial}
            </div>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullName">Nome</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
          <Button onClick={saveProfile} disabled={savingProfile || fullName.trim() === initialName.trim()}>
            {savingProfile ? "Salvando..." : "Salvar perfil"}
          </Button>
        </div>
      </motion.div>

      {/* E-mail */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-6">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-primary" /> E-mail
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>E-mail atual</Label>
            <Input value={user?.email || ""} readOnly disabled type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newEmail">Novo e-mail</Label>
            <Input
              id="newEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="novo@email.com"
            />
            <p className="text-xs text-muted-foreground">
              Você receberá um link de confirmação no novo endereço; a troca só vale após confirmar.
            </p>
          </div>
          <Button onClick={changeEmail} disabled={savingEmail || !newEmail.trim()}>
            {savingEmail ? "Enviando..." : "Solicitar troca de e-mail"}
          </Button>
        </div>
      </motion.div>

      {/* Senha */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-6">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5 text-primary" /> Senha
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPw">Senha atual</Label>
            <Input id="currentPw" type={showPw ? "text" : "password"} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPw">Nova senha</Label>
            <div className="relative">
              <Input id="newPw" type={showPw ? "text" : "password"} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="mínimo 6 caracteres" className="pr-10" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPw">Confirmar nova senha</Label>
            <Input id="confirmPw" type={showPw ? "text" : "password"} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="repita a nova senha" />
          </div>
          <Button onClick={changePassword} disabled={savingPw || !currentPw || !newPw || !confirmPw}>
            {savingPw ? "Alterando..." : "Alterar senha"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default AccountSettings;

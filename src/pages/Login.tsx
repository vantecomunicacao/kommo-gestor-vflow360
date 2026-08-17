import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions, landingPath } from "@/contexts/PermissionsContext";
import { Navigate } from "react-router-dom";
import { useForceLightTheme } from "@/hooks/useForceLightTheme";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { permissions, loading: permsLoading } = usePermissions();

  // Telas de auth são sempre modo claro, sem opção de alternar.
  useForceLightTheme();

  if (authLoading) return null;
  // Logado: espera as permissoes e roteia pra primeira area liberada (ver landingPath).
  if (user) {
    if (permsLoading) return null;
    return <Navigate to={landingPath(permissions)} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao entrar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Login realizado com sucesso!" });
      // Redirect feito pelo guard acima quando user + permissoes carregam.
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center gradient-primary relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full border border-white/20"
              style={{
                width: `${200 + i * 150}px`,
                height: `${200 + i * 150}px`,
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-center z-10 px-12"
        >
          <img
            src="/vflow360-logo-escuro.png"
            alt="VFlow360"
            className="h-12 w-auto mx-auto mb-8"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <p className="text-white text-lg max-w-md leading-relaxed">
            Acompanhe seus principais indicadores, identifique oportunidades e tome decisões mais assertivas com dados do seu CRM Kommo.
          </p>
        </motion.div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="w-full max-w-md">
          <div className="lg:hidden flex mb-8 justify-center">
            <img src="/vflow360-logo.png" alt="VFlow360" className="h-9 w-auto dark:hidden" />
            <img src="/vflow360-logo-escuro.png" alt="VFlow360" className="h-9 w-auto hidden dark:block" />
          </div>

          <h2 className="text-2xl font-semibold text-foreground mb-1">Bem-vindo de volta</h2>
          <p className="text-muted-foreground mb-8">Entre com suas credenciais para continuar</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="email" type="email" placeholder="seu@email.com" className="pl-10" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="password">Senha</Label>
                <Link to="/forgot-password" className="text-sm text-primary hover:underline">Esqueceu a senha?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="password" type="password" placeholder="••••••••" className="pl-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            </div>

            <Button type="submit" variant="brand" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Não tem uma conta?{" "}
            <Link to="/register" className="text-primary hover:underline font-medium">Criar conta</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;

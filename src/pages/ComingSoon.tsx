import { Construction } from "lucide-react";

interface ComingSoonProps {
  title?: string;
}

const ComingSoon = ({ title = "Em breve" }: ComingSoonProps) => {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Construction className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-sm text-muted-foreground">
        Esta funcionalidade está em desenvolvimento e estará disponível em breve.
      </p>
    </div>
  );
};

export default ComingSoon;

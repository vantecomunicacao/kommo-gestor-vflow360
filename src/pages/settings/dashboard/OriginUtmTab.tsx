import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CustomField { id: string; kommo_id: string; name: string; code: string | null; field_type?: string | null; entity_type?: string | null; }

interface OriginUtmTabProps {
  customFields: CustomField[];
  originFieldName: string;
  setOriginFieldName: (v: string) => void;
  utmSourceField: string;
  setUtmSourceField: (v: string) => void;
  utmMediumField: string;
  setUtmMediumField: (v: string) => void;
  utmCampaignField: string;
  setUtmCampaignField: (v: string) => void;
  utmContentField: string;
  setUtmContentField: (v: string) => void;
  utmTermField: string;
  setUtmTermField: (v: string) => void;
}

export default function OriginUtmTab({
  customFields, originFieldName, setOriginFieldName,
  utmSourceField, setUtmSourceField, utmMediumField, setUtmMediumField,
  utmCampaignField, setUtmCampaignField, utmContentField, setUtmContentField,
  utmTermField, setUtmTermField,
}: OriginUtmTabProps) {
  const leadFields = customFields.filter((f) => (f.entity_type || "").toLowerCase() === "leads");

  return (
    <>
      {/* Origem do lead */}
      <Card>
        <CardHeader>
          <CardTitle>Origem do lead (opcional)</CardTitle>
          <CardDescription>
            Campo personalizado que indica a origem do lead. Quando configurado, ele tem prioridade sobre o UTM Source
            nos gráficos "Origem dos leads" e "Origem das vendas". Se não configurar, a origem cai no UTM Source.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={originFieldName || "__none__"} onValueChange={(v) => setOriginFieldName(v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="— não configurado —" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— não configurado —</SelectItem>
              {leadFields.map((f) => (
                <SelectItem key={f.id} value={f.code || f.kommo_id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Campos UTM */}
      <Card>
        <CardHeader>
          <CardTitle>Campos UTM</CardTitle>
          <CardDescription>
            Mapeie quais campos personalizados do Kommo correspondem aos parâmetros UTM. Source e Campaign alimentam os pies "Origem dos leads" e "Origem das vendas" no dashboard. Medium é usado como filtro. Content e Term ficam disponíveis para análises detalhadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "source", label: "UTM Source", value: utmSourceField, setter: setUtmSourceField, hint: "Plataforma (ex.: google, facebook, instagram)" },
            { key: "medium", label: "UTM Medium", value: utmMediumField, setter: setUtmMediumField, hint: "Tipo de mídia (ex.: cpc, social, organic, email)" },
            { key: "campaign", label: "UTM Campaign", value: utmCampaignField, setter: setUtmCampaignField, hint: "Campanha específica (ex.: black-friday, lançamento-x)" },
            { key: "content", label: "UTM Content", value: utmContentField, setter: setUtmContentField, hint: "Variação criativa / anúncio (ex.: video-30s-v2, carrossel-azul)" },
            { key: "term", label: "UTM Term", value: utmTermField, setter: setUtmTermField, hint: "Público-alvo, palavra-chave ou segmentação (ex.: lookalike-1pct)" },
          ].map((utm) => (
            <div key={utm.key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
              <div>
                <Label className="text-sm font-medium">{utm.label}</Label>
                <p className="text-xs text-muted-foreground">{utm.hint}</p>
              </div>
              <div className="md:col-span-2">
                <Select value={utm.value || "__none__"} onValueChange={(v) => utm.setter(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione um campo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— não configurado —</SelectItem>
                    {leadFields.map((f) => (
                      <SelectItem key={f.id} value={f.code || f.kommo_id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

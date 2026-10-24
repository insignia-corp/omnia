import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { MetricasModule } from "../metricas/metricas.module";
import { somarDias } from "../lib/datas/datas";
import { MetricasService } from "../metricas/metricas.service";
import { CicloDoAlerta } from "./ciclo-do-alerta";
import { criarHoje } from "./jobs/hoje";
import { FilaReajuste } from "./jobs/fila-reajuste";
import { VerificadorDeReajuste } from "./jobs/verificar-reajuste";
import { FONTE_DE_LIMITES, type FonteDeLimites } from "./limites";
import { FonteDeLimitesPostgres } from "./limites-do-comerciante";
import { MotorDeAlertas } from "./motor-de-alertas";
import {
  REPOSITORIO_ALERTAS,
  RepositorioAlertasPostgres,
  type RepositorioAlertas,
} from "./repositorio-alertas";

@Module({
  imports: [MetricasModule],
  providers: [
    {
      provide: FONTE_DE_LIMITES,
      inject: [DB],
      useFactory: (db: Db): FonteDeLimites => new FonteDeLimitesPostgres(db),
    },
    {
      provide: REPOSITORIO_ALERTAS,
      inject: [DB],
      useFactory: (db: Db) => new RepositorioAlertasPostgres(db),
    },
    {
      provide: MotorDeAlertas,
      inject: [MetricasService, REPOSITORIO_ALERTAS, FONTE_DE_LIMITES],
      useFactory: (metricas: MetricasService, alertas: RepositorioAlertas, limites: FonteDeLimites) =>
        new MotorDeAlertas(metricas, alertas, limites),
    },
    {
      provide: VerificadorDeReajuste,
      inject: [DB, MotorDeAlertas, ENV],
      useFactory: (db: Db, motor: MotorDeAlertas, env: Env) => {
        const hoje = criarHoje(env);
        // Os avisos são do último dia completo (ontem), o mesmo dia que list_alert_candidates e o painel leem.
        return new VerificadorDeReajuste(db, motor, () => somarDias(hoje(), -1));
      },
    },
    { provide: CicloDoAlerta, inject: [DB], useFactory: (db: Db) => new CicloDoAlerta(db) },
    FilaReajuste,
  ],
  exports: [MotorDeAlertas, FilaReajuste, CicloDoAlerta],
})
export class AlertasModule {}

import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { dataLocal, relogioComDataFixa, relogioDoSistema } from "../canal/relogio";
import { DB, type Db } from "../infra/database/database.module";
import { MetricasModule } from "../metricas/metricas.module";
import { MetricasService } from "../metricas/metricas.service";
import { FilaReajuste } from "./jobs/fila-reajuste";
import { VerificadorDeReajuste } from "./jobs/verificar-reajuste";
import { FONTE_DE_LIMITES, fonteDeLimitesPadrao, type FonteDeLimites } from "./limites";
import { MotorDeAlertas } from "./motor-de-alertas";
import {
  REPOSITORIO_ALERTAS,
  RepositorioAlertasPostgres,
  type RepositorioAlertas,
} from "./repositorio-alertas";

@Module({
  imports: [MetricasModule],
  providers: [
    { provide: FONTE_DE_LIMITES, useValue: fonteDeLimitesPadrao },
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
        // Mesma regra do relógio do canal (data fixa da demo), sem importar o CanalModule: ele importa
        // a ingestão, que importa este módulo.
        const relogio = env.DEMO_DATA_REFERENCIA
          ? relogioComDataFixa(env.DEMO_DATA_REFERENCIA, env.FUSO_HORARIO)
          : relogioDoSistema;
        return new VerificadorDeReajuste(db, motor, () => dataLocal(relogio.agora(), env.FUSO_HORARIO));
      },
    },
    FilaReajuste,
  ],
  exports: [MotorDeAlertas, FilaReajuste],
})
export class AlertasModule {}

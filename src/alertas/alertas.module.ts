import { Module } from "@nestjs/common";
import { DB, type Db } from "../infra/database/database.module";
import { MetricasModule } from "../metricas/metricas.module";
import { MetricasService } from "../metricas/metricas.service";
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
  ],
  exports: [MotorDeAlertas],
})
export class AlertasModule {}

import { Module } from "@nestjs/common";
import { DB, type Db } from "../infra/database/database.module";
import { MetricasService } from "./metricas.service";
import {
  FONTE_DE_DADOS_METRICAS,
  RepositorioMetricasPostgres,
  type FonteDeDadosMetricas,
} from "./repositorio-metricas";

@Module({
  providers: [
    {
      provide: FONTE_DE_DADOS_METRICAS,
      inject: [DB],
      useFactory: (db: Db) => new RepositorioMetricasPostgres(db),
    },
    {
      provide: MetricasService,
      inject: [FONTE_DE_DADOS_METRICAS],
      useFactory: (dados: FonteDeDadosMetricas) => new MetricasService(dados),
    },
  ],
  exports: [MetricasService],
})
export class MetricasModule {}

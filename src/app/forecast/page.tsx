import type { Metadata } from "next";
import { ForecastClient } from "./forecast-client";

export const metadata: Metadata = {
  title: "Forecast · BodyCast",
  description: "Explore probabilistic body-composition forecasts under different routines.",
};

export default function ForecastPage() {
  return <ForecastClient />;
}

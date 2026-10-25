import { Abril_Fatface, Inter, Montserrat, Poppins } from "next/font/google";
import { StudioView } from "@/components/studio/StudioView";

const montserrat = Montserrat({ subsets: ["latin"], weight: "800", variable: "--caption-montserrat" });
const poppins = Poppins({ subsets: ["latin"], weight: "700", variable: "--caption-poppins" });
const inter = Inter({ subsets: ["latin"], weight: "700", variable: "--caption-inter" });
const abril = Abril_Fatface({ subsets: ["latin"], weight: "400", variable: "--caption-abril-fatface" });

export default function StudioPage() {
  return <div className={`${montserrat.variable} ${poppins.variable} ${inter.variable} ${abril.variable}`}><StudioView /></div>;
}

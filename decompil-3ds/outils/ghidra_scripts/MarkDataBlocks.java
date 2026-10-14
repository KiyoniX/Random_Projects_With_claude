// Avant l'analyse, pour une image brute (boot9, boot11, kernel9) : met à part ce qui n'est pas du code.
// Argument : « 0xDÉBUT-0xFIN,0xDÉBUT-0xFIN » (FIN exclue), les plages de l'image qui ne sont pas du code, calculées
// par ghidra_raw.py à partir des plages de code de raw_targets.toml.
//
// Pourquoi. Une image brute arrive en un seul bloc lisible, inscriptible et exécutable : tout y est candidat au code.
// Ghidra invente alors des fonctions dans les données (1 255 « fonctions Thumb » dans les zéros de kernel9), la
// recherche des trous de RecoverFunctions.java prend le bourrage pour du code, et dans boot9 elle irait jusqu'aux
// clés de la moitié protégée. Chaque plage devient ici son propre bloc, ni exécutable ni inscriptible, nommé
// data_<adresse> : aucun analyseur ni aucun script n'y désassemble plus rien, et DumpListing.java n'y lit rien.
// Les blocs de code restants deviennent non inscriptibles (le décompilateur lit alors leurs littéraux comme des
// constantes) et sont nommés code_<adresse>.
//
// Les graines sont posées ensuite par SeedFunctions.java, deuxième script d'avant l'analyse.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;

public class MarkDataBlocks extends GhidraScript {
    @Override
    public void run() throws Exception {
        String ranges = getScriptArgs()[0];
        Memory memory = currentProgram.getMemory();
        int marked = 0;
        if (!ranges.isEmpty() && !ranges.equals("-")) {
            for (String range : ranges.split(",")) {
                String[] bounds = range.split("-");
                Address start = toAddr(Long.decode(bounds[0]));
                long endExclusive = Long.decode(bounds[1]);
                MemoryBlock block = memory.getBlock(start);
                if (block == null) {
                    println(">> plage hors de l'image, laissée : " + range);
                    continue;
                }
                if (!block.getStart().equals(start)) {
                    memory.split(block, start);
                    block = memory.getBlock(start);
                }
                if (block.getEnd().getOffset() >= endExclusive) {
                    memory.split(block, toAddr(endExclusive));
                    block = memory.getBlock(start);
                }
                block.setExecute(false);
                block.setWrite(false);
                block.setName("data_" + Long.toHexString(start.getOffset()));
                marked++;
            }
        }
        for (MemoryBlock block : memory.getBlocks()) {
            if (block.isExecute()) {
                block.setWrite(false);
                block.setName("code_" + Long.toHexString(block.getStart().getOffset()));
            }
        }
        println(">> blocs : " + marked + " plage(s) de données rendues non exécutables");
    }
}

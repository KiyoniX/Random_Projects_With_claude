// Avant l'analyse : pose les graines que ghidra_direct.py a calculées.
// Argument : seeds.tsv, une ligne « 0xADRESSE <TAB> arm|thumb <TAB> réglage Call Fixup ou vide ».
//
// Pourquoi avant l'analyse. Une fonction qui n'est atteinte que par un pointeur rangé dans une table, Ghidra ne la
// trouve pas seul. Si on la lui donne d'emblée, dans le bon jeu d'instructions, tout ce qu'elle appelle est découvert
// au premier passage. On ne pose ici que les graines sûres ; les candidats douteux sont jugés après l'analyse, par
// RecoverFunctions.java, quand on sait ce qui est déjà du code.
//
// L'aide de « switch » du compilateur reçoit son réglage « Call Fixup » ici, avant l'analyse : sans lui, Ghidra y voit
// un appel ordinaire, croit que l'exécution continue juste après, et désassemble la table d'octets comme du code.
import ghidra.app.cmd.disassemble.ArmDisassembleCommand;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

public class SeedFunctions extends GhidraScript {
    @Override
    public void run() throws Exception {
        List<String[]> seeds = new ArrayList<>();
        for (String line : Files.readAllLines(Paths.get(getScriptArgs()[0]))) {
            if (!line.startsWith("0x")) continue;
            seeds.add(line.split("\t", -1));
        }
        // De la plus haute adresse à la plus basse : une fonction créée d'abord pourrait déborder sur la suivante,
        // alors que si la suivante existe déjà, Ghidra s'arrête à son entrée.
        seeds.sort((left, right) -> Long.compare(Long.decode(right[0]), Long.decode(left[0])));
        int created = 0, failed = 0, fixups = 0;
        for (String[] seed : seeds) {
            Address address = toAddr(Long.decode(seed[0]));
            boolean thumb = seed[1].equals("thumb");
            String fixup = seed.length > 2 ? seed[2] : "";
            if (getInstructionContaining(address) == null && getDataContaining(address) == null) {
                new ArmDisassembleCommand(address, null, thumb).applyTo(currentProgram, monitor);
            }
            Function function = getFunctionAt(address);
            if (function == null && getInstructionAt(address) != null) {
                function = createFunction(address, null);
                if (function != null) created++;
            }
            if (function == null) {
                failed++;
                println(">> graine refusée par Ghidra : " + address);
                continue;
            }
            if (!fixup.isEmpty()) {
                function.setCallFixup(fixup);
                fixups++;
            }
        }
        println(">> graines : " + created + " fonctions créées avant l'analyse, " + fixups
            + " aide(s) de switch réglée(s), " + failed + " refusée(s)");
    }
}

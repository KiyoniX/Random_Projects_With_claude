// Après l'analyse : pose les noms de fiches/<module>.noms.tsv.
// Argument : le fichier de noms, « 0xADRESSE <TAB> function|label|data <TAB> nom ». Une ligne « function » désigne une
// fonction ARM, une ligne « label » une fonction Thumb (c'est la convention des fiches : par le pont REA, une ligne
// « function » serait désassemblée en ARM), une ligne « data » une simple étiquette, même au milieu du code : une
// table posée dans une section exécutable (la table des appels système de kernel11) ne doit pas devenir une
// fonction. Les lignes sans nom sont ignorées.
//
// Pourquoi après l'analyse et pas avant. Créer d'avance toutes les fonctions nommées dérègle la découverte des
// fonctions qui ne reviennent pas : des corps restent vides (vu sur ptm). Et nommer d'avance l'aide de switch empêche
// Ghidra de la reconnaître : tout ce qui suit un « switch » est perdu (ptm tombait de 660 à 629 fonctions).
//
// Un nom dont l'adresse n'est pas encore une fonction en crée une : la fiche a été relue par quelqu'un, c'est une
// graine sûre. Ces créations sont comptées et listées à part, pour qu'on voie ce que la recherche automatique seule
// n'avait pas trouvé.
import ghidra.app.cmd.disassemble.ArmDisassembleCommand;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import java.nio.file.Files;
import java.nio.file.Paths;

public class ApplyNames extends GhidraScript {
    @Override
    public void run() throws Exception {
        int named = 0, created = 0, labels = 0, failed = 0;
        StringBuilder createdList = new StringBuilder();
        for (String line : Files.readAllLines(Paths.get(getScriptArgs()[0]))) {
            String[] fields = line.split("\t", -1);
            if (fields.length < 3 || !fields[0].startsWith("0x") || fields[2].isEmpty()) continue;
            Address address = toAddr(Long.decode(fields[0]));
            String name = fields[2];
            // Hors de la section de code, ou marqué « data », un nom est une simple étiquette sur une donnée.
            if (fields[1].equals("data") || !currentProgram.getMemory().getExecuteSet().contains(address)) {
                createLabel(address, name, true, SourceType.USER_DEFINED);
                labels++;
                continue;
            }
            Function function = getFunctionAt(address);
            if (function == null) {
                if (getInstructionAt(address) == null && getInstructionContaining(address) == null) {
                    new ArmDisassembleCommand(address, null, fields[1].equals("label")).applyTo(currentProgram, monitor);
                }
                if (getInstructionAt(address) != null) function = createFunction(address, name);
                if (function != null) {
                    created++;
                    createdList.append(' ').append(fields[0]);
                }
            }
            if (function == null) {
                failed++;
                println(">> nom sans fonction : " + fields[0] + " " + name);
                createLabel(address, name, true, SourceType.USER_DEFINED);
                continue;
            }
            function.setName(name, SourceType.USER_DEFINED);
            named++;
        }
        if (created > 0) {
            println(">> fonctions créées par un nom de la fiche :" + createdList);
            analyzeChanges(currentProgram);
        }
        println(">> noms : " + named + " fonctions nommées, dont " + created + " créées par leur nom ; " + labels
            + " étiquette(s) de données ; " + failed + " nom(s) sans fonction");
    }
}

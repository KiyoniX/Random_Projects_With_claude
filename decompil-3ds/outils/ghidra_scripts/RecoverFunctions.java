// Après l'analyse : impose les tables des « switch » Thumb, puis crée les fonctions que l'analyse a manquées.
// Arguments : switches.tsv, candidates.tsv (écrits par ghidra_direct.py).
//
//   switches.tsv    « 0xAPPEL <TAB> nombre de cas <TAB> cible 0 <TAB> cible 1 ... » : une ligne par « blx aide de
//                   switch », la dernière cible est le cas par défaut.
//   candidates.tsv  « 0xADRESSE <TAB> arm|thumb <TAB> origine <TAB> groupe » : les candidats qu'il faut juger. Le
//                   groupe réunit les cases d'une même table de distances (« - » pour un pointeur isolé).
//
// Pourquoi juger après l'analyse. Un nombre rangé dans le code peut ressembler à un pointeur Thumb : les identifiants
// de blocs 0x00100001 et 0x00100003 de cfg « pointent » sur le point d'entrée du module. Une fois l'analyse faite,
// ces faux pointeurs se reconnaissent : ils tombent au milieu d'une fonction, ou sur du code de l'autre jeu
// d'instructions. Un vrai pointeur tombe sur des octets que Ghidra n'a pas encore lus, ou sur un début de fonction.
//
// Les trois gestes sont répétés tant qu'ils changent quelque chose, parce que chacun en débloque d'autres : une table
// de switch imposée fait apparaître le code des cas, donc de nouveaux appels, donc de nouvelles fonctions.
import ghidra.app.cmd.disassemble.ArmDisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressRange;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.data.ArrayDataType;
import ghidra.program.model.data.ByteDataType;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.pcode.JumpTable;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.SourceType;
import ghidra.app.util.PseudoDisassembler;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class RecoverFunctions extends GhidraScript {
    private static final int MAX_ROUNDS = 8;
    private Register thumbMode;
    private AddressSet switchTables = new AddressSet();
    private Set<Address> switchesDone = new HashSet<>();
    private Map<String, String> rejected = new LinkedHashMap<>();
    private Set<String> found = new HashSet<>();
    private Set<String> made = new HashSet<>();
    private int fromPointers = 0, fromTables = 0, fromGaps = 0, fromGlued = 0, absorbed = 0;

    @Override
    public void run() throws Exception {
        thumbMode = currentProgram.getProgramContext().getRegister("TMode");
        List<String[]> switches = readLines(getScriptArgs()[0]);
        List<String[]> candidates = readLines(getScriptArgs()[1]);
        for (String[] line : switches) {
            Address table = toAddr(Long.decode(line[0])).add(4);
            switchTables.add(table, table.add(Integer.parseInt(line[1]) + 1));
        }
        for (int round = 1; round <= MAX_ROUNDS; round++) {
            int changes = fixSwitchTables(switches);
            changes += judgeCandidates(candidates);
            if (changes > 0) analyzeChanges(currentProgram);
            int gaps = fillGaps();
            if (gaps > 0) analyzeChanges(currentProgram);
            println(">> passage " + round + " : " + (changes + gaps) + " changement(s)");
            if (changes + gaps == 0) break;
        }
        int missing = 0;
        for (String[] line : switches) {
            if (!switchesDone.contains(toAddr(Long.decode(line[0])))) {
                missing++;
                println(">> switch à " + line[0] + " : pas dans une fonction, laissé de côté");
            }
        }
        println(">> switch : " + switchesDone.size() + " table(s) imposée(s) sur " + switches.size()
            + (missing > 0 ? ", " + missing + " hors de toute fonction" : ""));
        for (Map.Entry<String, String> refusal : rejected.entrySet()) {
            println(">> candidat écarté : " + refusal.getKey() + " " + refusal.getValue());
        }
        println(">> fonctions créées après l'analyse : " + fromPointers + " par un pointeur, " + fromTables
            + " par une table de distances, " + fromGaps + " dans un trou qui commence par un « push », " + fromGlued
            + " dans un trou collé à la fin d'une fonction");
        println(">> candidats déjà trouvés par l'analyse : " + found.size() + " ; écartés : " + rejected.size()
            + " ; fonctions devinées par Ghidra et fondues dans la vraie : " + absorbed);
    }

    private List<String[]> readLines(String path) throws Exception {
        List<String[]> lines = new ArrayList<>();
        for (String line : Files.readAllLines(Paths.get(path))) {
            if (line.startsWith("0x")) lines.add(line.split("\t", -1));
        }
        return lines;
    }

    private boolean isThumb(Address address) {
        BigInteger value = currentProgram.getProgramContext().getValue(thumbMode, address, false);
        return value != null && value.intValue() == 1;
    }

    // Une table de switch : l'appel « blx aide » est suivi d'un octet N, de N octets (un par cas) et d'un octet pour le
    // cas par défaut. La cible d'un cas est (adresse après l'appel) + 2 × son octet. Ghidra reconnaît l'aide mais ne
    // retrouve pas toujours les cibles (« Could not recover jumptable ») : on les lui donne.
    private int fixSwitchTables(List<String[]> switches) throws Exception {
        int done = 0;
        for (String[] line : switches) {
            Address site = toAddr(Long.decode(line[0]));
            if (switchesDone.contains(site)) continue;
            Function function = getFunctionContaining(site);
            if (function == null || getInstructionAt(site) == null) continue;
            int count = Integer.parseInt(line[1]);
            Address table = site.add(4);
            // Si l'analyse a pris la table pour du code, on efface ce faux code avant de la déclarer comme octets.
            if (currentProgram.getListing().getInstructions(new AddressSet(table, table.add(count + 1)), true).hasNext()) {
                clearListing(table, table.add(count + 1));
            }
            try {
                currentProgram.getListing().createData(table, new ArrayDataType(ByteDataType.dataType, count + 2, 1));
            } catch (Exception alreadyDefined) {
                // Déjà des données à cet endroit : rien à faire.
            }
            ArrayList<Address> targets = new ArrayList<>();
            for (int index = 2; index < line.length; index++) {
                Address target = toAddr(Long.decode(line[index]));
                Function other = getFunctionAt(target);
                if (other != null && !other.equals(function)) removeFunction(other);
                if (getInstructionAt(target) == null) {
                    new ArmDisassembleCommand(target, null, true).applyTo(currentProgram, monitor);
                }
                if (!targets.contains(target)) {
                    currentProgram.getReferenceManager().addMemoryReference(site, target, RefType.COMPUTED_JUMP,
                        SourceType.USER_DEFINED, 0);
                }
                targets.add(target);
            }
            new JumpTable(site, targets, true, 0).writeOverride(function);
            CreateFunctionCmd.fixupFunctionBody(currentProgram, function, monitor);
            switchesDone.add(site);
            done++;
        }
        return done;
    }

    // Rend null si le candidat peut devenir une fonction, « déjà » s'il en est une, sinon la raison de l'écarter.
    private String verdict(Address address, boolean thumb) {
        Function at = getFunctionAt(address);
        if (at != null) return isThumb(address) == thumb ? "déjà" : "fonction de l'autre jeu d'instructions";
        Function around = getFunctionContaining(address);
        if (around != null) return "au milieu de la fonction " + around.getEntryPoint();
        if (switchTables.contains(address)) return "dans une table de switch";
        Instruction containing = getInstructionContaining(address);
        if (containing != null) {
            if (!containing.getAddress().equals(address)) return "au milieu d'une instruction";
            return isThumb(address) == thumb ? null : "code de l'autre jeu d'instructions";
        }
        Data data = getDataContaining(address);
        if (data != null && data.isDefined()) return "sur des données";
        // Le candidat doit se désassembler proprement jusqu'à du code connu ou un retour. On n'exige pas qu'il revienne :
        // une fonction de quatre octets qui appelle une fonction sans retour (cfg, 0x101b00) est une vraie fonction.
        PseudoDisassembler checker = new PseudoDisassembler(currentProgram);
        if (!checker.isValidSubroutine(thumb ? address.add(1) : address, true, false)) return "ne se désassemble pas en fonction";
        return null;
    }

    private boolean create(Address address, boolean thumb) throws Exception {
        if (getInstructionAt(address) == null) {
            new ArmDisassembleCommand(address, null, thumb).applyTo(currentProgram, monitor);
        }
        if (getInstructionAt(address) == null) return false;
        // Une fonction peut commencer par une instruction qui ne fait rien (les aiguillages de fs commencent par
        // « mov r0, r0 »). Ghidra, qui cherche les « push », a alors déjà créé une fonction juste après, que rien
        // n'appelle : la nôtre s'arrêterait au bout de quatre octets. On retire celle de Ghidra pour que la nôtre
        // prenne tout le corps.
        Instruction next = getInstructionAt(address);
        for (int step = 0; step < 2 && next != null && next.getFlowType().isFallthrough(); step++) {
            next = next.getNext();
            if (next == null) break;
            Function guessed = getFunctionAt(next.getAddress());
            if (guessed != null) {
                if (currentProgram.getReferenceManager().getReferenceCountTo(next.getAddress()) == 0) {
                    removeFunction(guessed);
                    absorbed++;
                }
                break;
            }
        }
        return createFunction(address, null) != null;
    }

    private int judgeCandidates(List<String[]> candidates) throws Exception {
        // Une table de distances est tout ou rien : si une seule de ses cases est écartée, ce n'était pas une table.
        Map<String, List<String[]>> groups = new LinkedHashMap<>();
        for (String[] line : candidates) {
            String group = line[3].equals("-") ? line[0] : line[3];
            groups.computeIfAbsent(group, key -> new ArrayList<>()).add(line);
        }
        int created = 0;
        for (Map.Entry<String, List<String[]>> group : groups.entrySet()) {
            String refusal = null;
            for (String[] line : group.getValue()) {
                String verdict = verdict(toAddr(Long.decode(line[0])), line[1].equals("thumb"));
                if (verdict != null && !verdict.equals("déjà")) {
                    refusal = line[0] + " " + verdict;
                    break;
                }
            }
            for (String[] line : group.getValue()) {
                Address address = toAddr(Long.decode(line[0]));
                boolean thumb = line[1].equals("thumb");
                if (refusal != null) {
                    // Un refus peut tomber au passage suivant, quand le code d'à côté est connu : on garde le dernier.
                    rejected.put(line[0], "(" + line[2] + ") : " + refusal);
                    continue;
                }
                rejected.remove(line[0]);
                if (getFunctionAt(address) != null) {
                    if (!made.contains(line[0])) found.add(line[0]);
                    continue;
                }
                if (create(address, thumb)) {
                    created++;
                    made.add(line[0]);
                    if (line[3].equals("-")) fromPointers++; else fromTables++;
                }
            }
        }
        return created;
    }

    // Les trous : des octets de la section de code que Ghidra n'a ni désassemblés ni typés. Deux cas donnent une
    // fonction que plus rien ne désigne (du code mort, ou appelé d'une façon qu'on n'a pas su lire) :
    // - le trou commence, après le bourrage, par « push {..., lr} » ;
    // - le trou est collé à la fin d'une fonction (juste après un retour ou un saut), dans le même jeu d'instructions.
    // Dans les deux cas le morceau doit se désassembler proprement jusqu'à un retour, sans couler dans du code déjà
    // connu : des données prises pour du code finissent presque toujours par déborder sur la fonction suivante.
    // On ne regarde que le début du trou : plus loin, on ne sait pas où les instructions commencent.
    private int fillGaps() throws Exception {
        int created = 0;
        AddressSetView code = currentProgram.getMemory().getExecuteSet();
        AddressSetView undefined = currentProgram.getListing().getUndefinedRanges(code, true, monitor);
        List<Address> starts = new ArrayList<>();
        List<Boolean> modes = new ArrayList<>();
        List<Boolean> prologues = new ArrayList<>();
        for (AddressRange range : undefined) {
            Address address = range.getMinAddress();
            Address last = range.getMaxAddress();
            Instruction before = currentProgram.getListing().getInstructionBefore(address);
            boolean glued = before != null && before.getMaxAddress().add(1).equals(address)
                && !before.hasFallthrough() && getFunctionContaining(before.getAddress()) != null;
            if (address.getOffset() % 2 != 0) address = address.add(1);
            // Le bourrage entre deux fonctions : des zéros, ou le « nop » Thumb (0x46C0).
            while (address.add(1).compareTo(last) <= 0) {
                int half = currentProgram.getMemory().getShort(address) & 0xFFFF;
                if (half != 0 && half != 0x46C0) break;
                address = address.add(2);
            }
            if (address.add(1).compareTo(last) > 0 || switchTables.contains(address)) continue;
            if (getFunctionContaining(address) != null) continue;
            int half = currentProgram.getMemory().getShort(address) & 0xFFFF;
            boolean thumb = (half & 0xFF00) == 0xB500;
            boolean arm = false;
            if (!thumb && address.getOffset() % 4 == 0 && address.add(3).compareTo(last) <= 0) {
                arm = (currentProgram.getMemory().getInt(address) & 0xFFFF4000) == 0xE92D4000;
            }
            boolean prologue = thumb || arm;
            if (!prologue) {
                if (!glued) continue;
                thumb = isThumb(before.getAddress());
                if (!thumb && address.getOffset() % 4 != 0) continue;
            }
            PseudoDisassembler checker = new PseudoDisassembler(currentProgram);
            if (!checker.isValidSubroutine(thumb ? address.add(1) : address, false, true)) continue;
            starts.add(address);
            modes.add(thumb);
            prologues.add(prologue);
        }
        for (int index = starts.size() - 1; index >= 0; index--) {
            if (getFunctionContaining(starts.get(index)) == null && create(starts.get(index), modes.get(index))) {
                created++;
                if (prologues.get(index)) fromGaps++; else fromGlued++;
                println(">> fonction trouvée dans un trou : " + starts.get(index) + (modes.get(index) ? " (Thumb" : " (ARM")
                    + (prologues.get(index) ? ", commence par un push)" : ", collée à la fin d'une fonction : à relire)"));
            }
        }
        return created;
    }
}

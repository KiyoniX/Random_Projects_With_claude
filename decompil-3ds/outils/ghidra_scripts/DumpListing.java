// Après l'analyse : range l'assembleur, une fonction par fichier, plus un listing de tout le code.
// Argument : le dossier de sortie (local/analyse/<cible>/gh/, vu d'Ubuntu).
//
//   asm/0xADRESSE.s   les instructions d'une fonction, « adresse A|T instruction », A pour l'ARM, T pour le Thumb
//   listing.txt       toutes les instructions des blocs exécutables, dans l'ordre, chaque fonction annoncée par son nom
//
// Chaque référence d'une instruction est ajoutée en fin de ligne (« ; -> adresse nom »). Pour la lecture d'un
// littéral, le mot lu est ajouté aussi (« =0x... »), mais seulement s'il est dans un bloc exécutable (une réserve de
// littéraux au milieu du code) : un bloc de données n'est jamais lu, pour que les clés de boot9, rangées dans des
// blocs non exécutables par MarkDataBlocks.java, n'apparaissent dans aucun fichier.
//
// Pourquoi l'assembleur à côté du pseudo-code. Le décompilateur ne montre pas certains arguments passés en registres
// autour des appels (les numéros d'emplacements de clés de boot9, par exemple) : il faut alors lire les instructions.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import java.io.PrintWriter;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class DumpListing extends GhidraScript {
    private Register thumbMode;

    @Override
    public void run() throws Exception {
        Path out = Paths.get(getScriptArgs()[0]);
        Path asm = out.resolve("asm");
        Files.createDirectories(asm);
        thumbMode = currentProgram.getProgramContext().getRegister("TMode");
        int count = 0;
        for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
            StringBuilder text = new StringBuilder();
            text.append("; ").append(function.getName()).append(" @ ").append(function.getEntryPoint()).append('\n');
            InstructionIterator it = currentProgram.getListing().getInstructions(function.getBody(), true);
            while (it.hasNext()) text.append(line(it.next())).append('\n');
            Files.writeString(asm.resolve("0x" + Long.toHexString(function.getEntryPoint().getOffset()) + ".s"),
                text.toString(), StandardCharsets.UTF_8);
            count++;
        }
        try (PrintWriter all = new PrintWriter(Files.newBufferedWriter(out.resolve("listing.txt"), StandardCharsets.UTF_8))) {
            for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
                if (!block.isExecute()) {
                    all.print("; ---- bloc de données " + block.getName() + " " + block.getStart() + "-" + block.getEnd()
                        + " (non listé)\n");
                    continue;
                }
                InstructionIterator it = currentProgram.getListing().getInstructions(block.getStart(), true);
                while (it.hasNext()) {
                    Instruction instruction = it.next();
                    if (!block.contains(instruction.getAddress())) break;
                    Function at = getFunctionAt(instruction.getAddress());
                    if (at != null) all.print("\n; ==== " + at.getName() + "\n");
                    all.print(line(instruction) + "\n");
                }
            }
        }
        println(">> assembleur : " + count + " fonction(s) dans asm/, tout le code dans listing.txt");
    }

    private String line(Instruction instruction) throws Exception {
        Address address = instruction.getAddress();
        BigInteger mode = currentProgram.getProgramContext().getValue(thumbMode, address, false);
        boolean thumb = mode != null && mode.intValue() == 1;
        StringBuilder text = new StringBuilder();
        text.append(String.format("%08x %s  %s", address.getOffset(), thumb ? "T" : "A", instruction.toString()));
        for (Reference reference : instruction.getReferencesFrom()) {
            Address to = reference.getToAddress();
            if (!to.isMemoryAddress()) continue;
            text.append("  ; -> ").append(Long.toHexString(to.getOffset()));
            Function target = getFunctionAt(to);
            if (target != null) text.append(" ").append(target.getName());
            MemoryBlock block = currentProgram.getMemory().getBlock(to);
            if (reference.getReferenceType().isRead() && block != null && block.isExecute()
                && block.contains(to.add(3))) {
                text.append(String.format(" =0x%08x", currentProgram.getMemory().getInt(to) & 0xFFFFFFFFL));
            }
        }
        return text.toString();
    }
}

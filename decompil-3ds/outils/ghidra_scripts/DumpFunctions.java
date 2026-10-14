// Après l'analyse : range la liste des fonctions, le pseudo-code et les références.
// Argument : le dossier de sortie (local/analyse/<module>/gh/, vu d'Ubuntu).
//
//   funcs.tsv   « 0xADRESSE <TAB> taille <TAB> arm|thumb <TAB> nom », une ligne par fonction. La taille est celle du
//               corps vu par Ghidra : elle ne compte pas les tables d'adresses posées au milieu du code.
//   pseudo/     un fichier 0xADRESSE.c par fonction.
//   refs.tsv    « 0xDEPUIS <TAB> 0xVERS <TAB> genre <TAB> 0xFONCTION qui contient DEPUIS » : toutes les références,
//               pour savoir qui appelle qui et qui lit quelle donnée.
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;
import java.io.PrintWriter;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class DumpFunctions extends GhidraScript {
    private static final int DECOMPILE_TIMEOUT_SECONDS = 90;

    @Override
    public void run() throws Exception {
        Path out = Paths.get(getScriptArgs()[0]);
        Path pseudo = out.resolve("pseudo");
        Files.createDirectories(pseudo);
        Register thumbMode = currentProgram.getProgramContext().getRegister("TMode");
        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        int count = 0, thumbCount = 0, failed = 0;
        try (PrintWriter list = new PrintWriter(Files.newBufferedWriter(out.resolve("funcs.tsv"), StandardCharsets.UTF_8))) {
            for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
                Address entry = function.getEntryPoint();
                BigInteger mode = currentProgram.getProgramContext().getValue(thumbMode, entry, false);
                boolean thumb = mode != null && mode.intValue() == 1;
                String address = "0x" + Long.toHexString(entry.getOffset());
                list.print(address + "\t" + function.getBody().getNumAddresses() + "\t" + (thumb ? "thumb" : "arm")
                    + "\t" + function.getName() + "\n");
                DecompileResults results = decompiler.decompileFunction(function, DECOMPILE_TIMEOUT_SECONDS, monitor);
                String text;
                if (results.decompileCompleted()) {
                    text = results.getDecompiledFunction().getC();
                } else {
                    text = "/* décompilation ratée : " + results.getErrorMessage() + " */\n";
                    failed++;
                }
                Files.writeString(pseudo.resolve(address + ".c"), text, StandardCharsets.UTF_8);
                count++;
                if (thumb) thumbCount++;
            }
        }
        ReferenceManager references = currentProgram.getReferenceManager();
        FunctionManager functions = currentProgram.getFunctionManager();
        try (PrintWriter refs = new PrintWriter(Files.newBufferedWriter(out.resolve("refs.tsv"), StandardCharsets.UTF_8))) {
            AddressIterator sources = references.getReferenceSourceIterator(currentProgram.getMemory(), true);
            while (sources.hasNext()) {
                Address from = sources.next();
                Function owner = functions.getFunctionContaining(from);
                for (Reference reference : references.getReferencesFrom(from)) {
                    if (!reference.getToAddress().isMemoryAddress()) continue;
                    refs.print("0x" + Long.toHexString(from.getOffset()) + "\t0x"
                        + Long.toHexString(reference.getToAddress().getOffset()) + "\t" + reference.getReferenceType().getName()
                        + "\t" + (owner == null ? "" : "0x" + Long.toHexString(owner.getEntryPoint().getOffset())) + "\n");
                }
            }
        }
        println(">> " + count + " fonctions, dont " + thumbCount + " en Thumb ; " + failed + " décompilation(s) ratée(s)");
    }
}

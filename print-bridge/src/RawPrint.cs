using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO1 {
        public string pDocName;
        public string pOutputFile;
        public string pDataType;
    }

    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, DOCINFO1 pDocInfo);

    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static int Main(string[] args) {
        if (args.Length < 2) {
            Console.WriteLine("Usage: RawPrint.exe <PrinterName> <FilePath>");
            return 1;
        }

        string printerName = args[0];
        string filePath = args[1];

        if (!File.Exists(filePath)) {
            Console.WriteLine("Error: File not found: " + filePath);
            return 1;
        }

        byte[] bytes = File.ReadAllBytes(filePath);

        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            Console.WriteLine("Error: Failed to open printer: " + printerName);
            return 1;
        }

        DOCINFO1 di = new DOCINFO1();
        di.pDocName = "UniPro POS Receipt";
        di.pDataType = "RAW";

        if (!StartDocPrinter(hPrinter, 1, di)) {
            ClosePrinter(hPrinter);
            Console.WriteLine("Error: Failed to start doc printer.");
            return 1;
        }

        if (!StartPagePrinter(hPrinter)) {
            EndDocPrinter(hPrinter);
            ClosePrinter(hPrinter);
            Console.WriteLine("Error: Failed to start page printer.");
            return 1;
        }

        int written = 0;
        bool ok = WritePrinter(hPrinter, bytes, bytes.Length, out written);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);

        if (ok && written == bytes.Length) {
            Console.WriteLine("SUCCESS");
            return 0;
        } else {
            Console.WriteLine("Error: WritePrinter failed or incomplete write.");
            return 1;
        }
    }
}
